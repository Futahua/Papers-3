import { randomUUID } from 'node:crypto';
import { BaseWindow, WebContentsView, type Session } from 'electron';

import type { PreviewHostContext, PreviewRect } from './windowsPreviewHandlerBridge';

interface LiveWebBrowser {
  id: string;
  ownerKey: string;
  window: BaseWindow;
  view: WebContentsView;
  localRect: PreviewRect;
  surfaceBounds: PreviewRect;
  presented: boolean;
  sourceUrl: string;
}

export interface WebBrowserHostBridge {
  open(
    context: PreviewHostContext,
    url: string,
    localRect: PreviewRect,
  ): Promise<{ ok: true; sessionId: string; url: string } | { ok: false; error?: string }>;
  move(ownerKey: string, sessionId: string, localRect: PreviewRect): boolean;
  close(ownerKey: string, sessionId: string): boolean;
  setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewRect): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  closeOwner(ownerKey: string): void;
  raiseWindow(windowId: number): void;
  dispose(): void;
}

const BROWSER_PARTITION = 'persist:papers-web-browser';
const hardenedBrowserSessions = new WeakSet<Session>();

function hardenBrowserSession(browserSession: Session): void {
  if (hardenedBrowserSessions.has(browserSession)) return;
  hardenedBrowserSessions.add(browserSession);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on('will-download', (event) => event.preventDefault());
  browserSession.setCertificateVerifyProc((request, callback) => {
    const hostname = request.hostname.toLocaleLowerCase().replace(/^\[|\]$/g, '');
    const loopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
    const authorityOnly = request.errorCode === -202
      || request.verificationResult === 'net::ERR_CERT_AUTHORITY_INVALID'
      || request.verificationResult === 'CERT_AUTHORITY_INVALID';
    callback(loopback && authorityOnly ? 0 : -3);
  });
}

function validRect(rect: PreviewRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0
    && Math.abs(rect.x) <= 100_000
    && Math.abs(rect.y) <= 100_000
    && rect.width <= 100_000
    && rect.height <= 100_000;
}

function absoluteRect(surface: PreviewRect, local: PreviewRect): PreviewRect {
  return {
    x: Math.round(surface.x + local.x),
    y: Math.round(surface.y + local.y),
    width: Math.round(local.width),
    height: Math.round(local.height),
  };
}

function safeWebUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

export function createWebBrowserHostBridge(input: {
  resolveWindow(ownerKey: string): BaseWindow | null;
}): WebBrowserHostBridge {
  const sessions = new Map<string, LiveWebBrowser>();
  const owners = new Map<string, string>();

  const forget = (session: LiveWebBrowser): void => {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    if (owners.get(session.ownerKey) === session.id) owners.delete(session.ownerKey);
  };

  const cleanupSession = (session: LiveWebBrowser): void => {
    forget(session);
    if (session.presented && !session.window.isDestroyed()) {
      try { session.window.contentView.removeChildView(session.view); } catch { /* best effort */ }
    }
    session.presented = false;
    if (!session.view.webContents.isDestroyed()) {
      try { session.view.webContents.close(); } catch { /* best effort */ }
    }
  };

  const place = (session: LiveWebBrowser): void => {
    if (session.window.isDestroyed() || session.view.webContents.isDestroyed()) return;
    session.view.setBounds(absoluteRect(session.surfaceBounds, session.localRect));
  };
  const closeOwner = (ownerKey: string): void => {
    const id = owners.get(ownerKey);
    const session = id ? sessions.get(id) : undefined;
    if (session) cleanupSession(session);
  };

  return {
    async open(context, rawUrl, localRect) {
      const url = safeWebUrl(rawUrl);
      if (!url) return { ok: false, error: 'Only http and https links can open in the link viewer.' };
      if (!validRect(context.surfaceBounds) || !validRect(localRect)) {
        return { ok: false, error: 'Invalid link-viewer geometry.' };
      }

      const existingId = owners.get(context.ownerKey);
      const existing = existingId ? sessions.get(existingId) : undefined;
      if (existing && !existing.window.isDestroyed() && !existing.view.webContents.isDestroyed()) {
        existing.localRect = { ...localRect };
        existing.surfaceBounds = { ...context.surfaceBounds };
        if (!existing.presented) {
          existing.window.contentView.addChildView(existing.view);
          existing.presented = true;
        }
        place(existing);
        if (existing.sourceUrl === url) {
          return { ok: true, sessionId: existing.id, url };
        }
        try {
          await existing.view.webContents.loadURL(url);
          existing.sourceUrl = url;
          return { ok: true, sessionId: existing.id, url };
        } catch (error) {
          return { ok: false, error: boundedError(error) };
        }
      }

      closeOwner(context.ownerKey);
      const window = input.resolveWindow(context.ownerKey);
      if (!window || window.isDestroyed()) {
        return { ok: false, error: 'The owning Papers window is unavailable.' };
      }

      const view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          partition: BROWSER_PARTITION,
        },
      });
      const contents = view.webContents;
      hardenBrowserSession(contents.session);
      contents.on('will-navigate', (event, nextUrl) => {
        if (safeWebUrl(nextUrl)) return;
        event.preventDefault();
      });
      contents.setWindowOpenHandler(({ url: nextUrl }) => {
        const safe = safeWebUrl(nextUrl);
        if (safe) void contents.loadURL(safe).catch(() => {});
        return { action: 'deny' };
      });

      const session: LiveWebBrowser = {
        id: randomUUID(),
        ownerKey: context.ownerKey,
        window,
        view,
        localRect: { ...localRect },
        surfaceBounds: { ...context.surfaceBounds },
        presented: false,
        sourceUrl: url,
      };
      sessions.set(session.id, session);
      owners.set(session.ownerKey, session.id);
      contents.once('destroyed', () => {
        if (sessions.get(session.id) === session) forget(session);
      });

      try {
        window.contentView.addChildView(view);
        session.presented = true;
        place(session);
        await contents.loadURL(url);
        return { ok: true, sessionId: session.id, url };
      } catch (error) {
        cleanupSession(session);
        return { ok: false, error: boundedError(error) };
      }
    },

    move(ownerKey, sessionId, localRect) {
      const session = sessions.get(sessionId);
      if (!session || session.ownerKey !== ownerKey || !validRect(localRect)) return false;
      session.localRect = { ...localRect };
      place(session);
      return true;
    },

    close(ownerKey, sessionId) {
      const session = sessions.get(sessionId);
      if (!session || session.ownerKey !== ownerKey) return false;
      cleanupSession(session);
      return true;
    },

    setOwnerSurfaceBounds(ownerKey, bounds) {
      if (!validRect(bounds)) return;
      const id = owners.get(ownerKey);
      const session = id ? sessions.get(id) : undefined;
      if (!session) return;
      session.surfaceBounds = { ...bounds };
      place(session);
    },

    setOwnerVisible(ownerKey, visible) {
      const id = owners.get(ownerKey);
      const session = id ? sessions.get(id) : undefined;
      if (!session || session.window.isDestroyed() || session.view.webContents.isDestroyed()) return;
      if (visible) {
        if (!session.presented) {
          session.window.contentView.addChildView(session.view);
          session.presented = true;
        }
        place(session);
      } else if (session.presented) {
        session.window.contentView.removeChildView(session.view);
        session.presented = false;
      }
    },

    closeOwner(ownerKey) {
      closeOwner(ownerKey);
    },

    raiseWindow(windowId) {
      for (const session of sessions.values()) {
        if (session.window.id !== windowId || !session.presented
          || session.window.isDestroyed() || session.view.webContents.isDestroyed()) continue;
        session.window.contentView.addChildView(session.view);
        place(session);
      }
    },

    dispose() {
      for (const session of [...sessions.values()]) cleanupSession(session);
    },
  };
}