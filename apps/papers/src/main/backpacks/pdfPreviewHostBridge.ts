import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BaseWindow, WebContentsView, type WebFrameMain } from 'electron';

import type { PreviewHostContext, PreviewRect } from './windowsPreviewHandlerBridge';

interface PdfReadingState {
  page: number;
  position: { x: number; y: number } | null;
  zoom: number | null;
}

interface LivePdfPreview {
  id: string;
  ownerKey: string;
  window: BaseWindow;
  view: WebContentsView;
  localRect: PreviewRect;
  surfaceBounds: PreviewRect;
  presented: boolean;
  cleanup: () => void;
  stateKey: string | null;
  checkpointTimer: NodeJS.Timeout | null;
  closing: boolean;
}

export interface PdfPreviewHostBridge {
  open(
    context: PreviewHostContext,
    url: string,
    localRect: PreviewRect,
    cleanup: () => void,
    stateKey?: string | null,
  ): Promise<{ ok: true; sessionId: string } | { ok: false; error?: string }>;
  move(ownerKey: string, sessionId: string, localRect: PreviewRect): boolean;
  close(ownerKey: string, sessionId: string): Promise<boolean>;
  setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewRect): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  closeOwner(ownerKey: string): void;
  raiseWindow(windowId: number): void;
  dispose(): void;
}

const PDF_EXTENSION_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
const STATE_KEY_PATTERN = /^[0-9a-f]{64}$/i;

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

function readingStatePath(directory: string, stateKey: string): string {
  return path.join(directory, `${stateKey}.json`);
}

async function loadReadingState(directory: string, stateKey: string | null): Promise<PdfReadingState | null> {
  if (!stateKey || !STATE_KEY_PATTERN.test(stateKey)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(readingStatePath(directory, stateKey), 'utf8')) as Partial<PdfReadingState>;
    const page = Number(parsed.page);
    const zoom = parsed.zoom == null ? null : Number(parsed.zoom);
    const x = parsed.position == null ? null : Number(parsed.position.x);
    const y = parsed.position == null ? null : Number(parsed.position.y);
    if (!Number.isSafeInteger(page) || page < 0 || page > 1_000_000) return null;
    if (zoom !== null && (!Number.isFinite(zoom) || zoom <= 0 || zoom > 100)) return null;
    const position = x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)
      ? null
      : { x, y };
    return { page, zoom, position };
  } catch {
    return null;
  }
}

async function saveReadingState(directory: string, stateKey: string | null, state: PdfReadingState | null): Promise<void> {
  if (!stateKey || !STATE_KEY_PATTERN.test(stateKey) || !state) return;
  await fs.mkdir(directory, { recursive: true });
  const target = readingStatePath(directory, stateKey);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state), 'utf8');
  await fs.rename(temp, target).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') {
      await fs.rm(target, { force: true });
      await fs.rename(temp, target);
      return;
    }
    throw error;
  });
}

function pdfFrame(view: WebContentsView): WebFrameMain | null {
  return view.webContents.mainFrame.frames.find((frame) => frame.url.startsWith(PDF_EXTENSION_ORIGIN)) ?? null;
}

async function waitForPdfFrame(view: WebContentsView, timeoutMs = 4_000): Promise<WebFrameMain | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (view.webContents.isDestroyed()) return null;
    const frame = pdfFrame(view);
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function captureReadingState(view: WebContentsView): Promise<PdfReadingState | null> {
  if (view.webContents.isDestroyed()) return null;
  const frame = pdfFrame(view);
  if (!frame) return null;
  try {
    const state = await frame.executeJavaScript(`(()=>{
      const viewer=document.querySelector('pdf-viewer');
      const viewport=viewer?.viewport;
      if(!viewport) return null;
      const page=Number(viewport.getMostVisiblePage?.() ?? 0);
      const position=viewport.position;
      const zoom=Number(viewport.getZoom?.());
      return {
        page:Number.isSafeInteger(page)&&page>=0?page:0,
        position:position&&Number.isFinite(position.x)&&Number.isFinite(position.y)?{x:Number(position.x),y:Number(position.y)}:null,
        zoom:Number.isFinite(zoom)&&zoom>0?zoom:null
      };
    })()`, true) as PdfReadingState | null;
    return state;
  } catch {
    return null;
  }
}

async function restoreReadingState(view: WebContentsView, state: PdfReadingState | null): Promise<void> {
  if (!state || view.webContents.isDestroyed()) return;
  const frame = await waitForPdfFrame(view);
  if (!frame) return;
  const payload = JSON.stringify(state);
  try {
    await frame.executeJavaScript(`(async()=>{
      const state=${payload};
      let viewer=null;
      for(let i=0;i<80;i++) {
        viewer=document.querySelector('pdf-viewer');
        if(viewer?.viewport && Number(viewer.loadProgress_)>=100) break;
        await new Promise(r=>setTimeout(r,50));
      }
      const viewport=viewer?.viewport;
      if(!viewport) return false;
      if(Number.isFinite(state.zoom)&&state.zoom>0) viewport.setZoom(state.zoom);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if(state.position&&Number.isFinite(state.position.x)&&Number.isFinite(state.position.y)) {
        viewport.setPosition({x:state.position.x,y:state.position.y});
      } else if(Number.isSafeInteger(state.page)&&state.page>=0) {
        viewport.goToPage(state.page);
      }
      return true;
    })()`, true);
  } catch {
    // A changed Chromium PDF viewer must not make the preview itself fail.
  }
}

export function createPdfPreviewHostBridge(input: {
  resolveWindow(ownerKey: string): BaseWindow | null;
  stateDirectory: string;
}): PdfPreviewHostBridge {
  const sessions = new Map<string, LivePdfPreview>();
  const owners = new Map<string, string>();

  const forget = (session: LivePdfPreview): void => {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    if (owners.get(session.ownerKey) === session.id) owners.delete(session.ownerKey);
  };

  const cleanupSession = async (session: LivePdfPreview): Promise<void> => {
    if (session.closing) return;
    session.closing = true;
    try {
      if (session.checkpointTimer) {
        clearInterval(session.checkpointTimer);
        session.checkpointTimer = null;
      }
      if (session.stateKey) {
        const state = await captureReadingState(session.view);
        await saveReadingState(input.stateDirectory, session.stateKey, state).catch(() => undefined);
      }
      forget(session);
      if (session.presented && !session.window.isDestroyed()) {
        try { session.window.contentView.removeChildView(session.view); } catch { /* best effort */ }
      }
      session.presented = false;
      if (!session.view.webContents.isDestroyed()) {
        try { session.view.webContents.close(); } catch { /* best effort */ }
      }
      try { session.cleanup(); } catch { /* cleanup is idempotent at the registry */ }
    } finally {
      session.closing = false;
    }
  };

  const place = (session: LivePdfPreview): void => {
    if (session.window.isDestroyed() || session.view.webContents.isDestroyed()) return;
    session.view.setBounds(absoluteRect(session.surfaceBounds, session.localRect));
  };

  return {
    async open(context, url, localRect, cleanup, stateKey = null) {
      if (!validRect(context.surfaceBounds) || !validRect(localRect)) {
        cleanup();
        return { ok: false, error: 'Invalid PDF preview geometry.' };
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        cleanup();
        return { ok: false, error: 'Invalid PDF preview URL.' };
      }
      if (parsed.protocol !== 'papers-file-preview:') {
        cleanup();
        return { ok: false, error: 'PDF preview URL is not an authorized preview resource.' };
      }
      if (stateKey !== null && !STATE_KEY_PATTERN.test(stateKey)) {
        cleanup();
        return { ok: false, error: 'PDF preview state key is invalid.' };
      }

      const priorId = owners.get(context.ownerKey);
      const prior = priorId ? sessions.get(priorId) : undefined;
      if (prior) await cleanupSession(prior);
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
        },
      });
      const session: LivePdfPreview = {
        id: randomUUID(),
        ownerKey: context.ownerKey,
        window,
        view,
        localRect: { ...localRect },
        surfaceBounds: { ...context.surfaceBounds },
        presented: false,
        cleanup,
        stateKey,
        checkpointTimer: null,
        closing: false,
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
        const savedState = await loadReadingState(input.stateDirectory, stateKey);
        await view.webContents.loadURL(parsed.toString());
        if (savedState) await restoreReadingState(view, savedState);
        if (stateKey) {
          session.checkpointTimer = setInterval(() => {
            void captureReadingState(view)
              .then((state) => saveReadingState(input.stateDirectory, stateKey, state))
              .catch(() => undefined);
          }, 2_000);
          session.checkpointTimer.unref?.();
        }
        return { ok: true, sessionId: session.id };
      } catch (error) {
        await cleanupSession(session);
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

    async close(ownerKey, sessionId) {
      const session = sessions.get(sessionId);
      if (!session || session.ownerKey !== ownerKey) return false;
      await cleanupSession(session);
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
      if (session) void cleanupSession(session);
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
      for (const session of [...sessions.values()]) void cleanupSession(session);
    },
  };
}
