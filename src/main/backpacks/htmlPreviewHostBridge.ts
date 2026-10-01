import { randomUUID } from 'node:crypto';
import { BaseWindow, WebContentsView } from 'electron';

import type { PreviewHostContext, PreviewRect } from './windowsPreviewHandlerBridge';

interface LiveHtmlPreview {
  id: string;
  ownerKey: string;
  window: BaseWindow;
  view: WebContentsView;
  localRect: PreviewRect;
  surfaceBounds: PreviewRect;
  presented: boolean;
  cleanup: () => void;
}

export interface HtmlPreviewHostBridge {
  open(
    context: PreviewHostContext,
    filePath: string,
    localRect: PreviewRect,
    cleanup: () => void,
  ): Promise<{ ok: true; sessionId: string } | { ok: false; error?: string }>;
  move(ownerKey: string, sessionId: string, localRect: PreviewRect): boolean;
  close(ownerKey: string, sessionId: string): boolean;
  setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewRect): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  closeOwner(ownerKey: string): void;
  raiseWindow(windowId: number): void;
  dispose(): void;
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

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

export function createHtmlPreviewHostBridge(input: {
  resolveWindow(ownerKey: string): BaseWindow | null;
}): HtmlPreviewHostBridge {
  const sessions = new Map<string, LiveHtmlPreview>();
  const owners = new Map<string, string>();

  const forget = (session: LiveHtmlPreview): void => {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    if (owners.get(session.ownerKey) === session.id) owners.delete(session.ownerKey);
  };

  const cleanupSession = (session: LiveHtmlPreview): void => {
    forget(session);
    if (session.presented && !session.window.isDestroyed()) {
      try { session.window.contentView.removeChildView(session.view); } catch { /* best effort */ }
    }
    session.presented = false;
    if (!session.view.webContents.isDestroyed()) {
      try { session.view.webContents.close(); } catch { /* best effort */ }
    }
    try { session.cleanup(); } catch { /* preview grant cleanup is idempotent */ }
  };

  const place = (session: LiveHtmlPreview): void => {
    if (session.window.isDestroyed() || session.view.webContents.isDestroyed()) return;
    session.view.setBounds(absoluteRect(session.surfaceBounds, session.localRect));
  };

  return {
    async open(context, filePath, localRect, cleanup) {
      if (!validRect(context.surfaceBounds) || !validRect(localRect)) {
        cleanup();
        return { ok: false, error: 'Invalid HTML preview geometry.' };
      }

      this.closeOwner(context.ownerKey);
      const window = input.resolveWindow(context.ownerKey);
      if (!window || window.isDestroyed()) {
        cleanup();
        return { ok: false, error: 'The owning Papers window is unavailable.' };
      }

      const view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      const session: LiveHtmlPreview = {
        id: randomUUID(),
        ownerKey: context.ownerKey,
        window,
        view,
        localRect: { ...localRect },
        surfaceBounds: { ...context.surfaceBounds },
        presented: false,
        cleanup,
      };
      sessions.set(session.id, session);
      owners.set(session.ownerKey, session.id);
      view.webContents.once('destroyed', () => {
        if (sessions.get(session.id) !== session) return;
        forget(session);
        try { session.cleanup(); } catch { /* best effort */ }
      });

      try {
        window.contentView.addChildView(view);
        session.presented = true;
        place(session);
        await view.webContents.loadFile(filePath);
        return { ok: true, sessionId: session.id };
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
      const id = owners.get(ownerKey);
      const session = id ? sessions.get(id) : undefined;
      if (session) cleanupSession(session);
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
