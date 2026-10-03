import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';

import {
  buildHoverPreviewDocument,
  HOVER_PREVIEW_TITLE_HEIGHT,
  hoverPreviewSignature,
  hoverPreviewWindowSize,
  placeHoverPreview,
  type HoverPreviewDescriptor,
} from './hoverPreviewPresentation';

export interface HoverPreviewWindowManagerDeps {
  createWindow?: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;
  ownerFromWebContents?: (sender: WebContents) => BrowserWindow | null;
  getDisplayMatching?: (bounds: Rectangle) => { workArea: Rectangle };
}

export function createHoverPreviewWindowManager(deps: HoverPreviewWindowManagerDeps = {}) {
  const createWindow = deps.createWindow ?? ((options) => new BrowserWindow(options));
  const ownerFromWebContents = deps.ownerFromWebContents ?? ((sender) => BrowserWindow.fromWebContents(sender));
  const getDisplayMatching = deps.getDisplayMatching ?? ((bounds) => screen.getDisplayMatching(bounds));

  const windows = new Map<number, BrowserWindow>();
  const signatures = new Map<number, string>();
  const revisions = new Map<number, number>();

  function hide(senderId: number): void {
    const preview = windows.get(senderId);
    windows.delete(senderId);
    signatures.delete(senderId);
    revisions.delete(senderId);
    if (preview && !preview.isDestroyed()) preview.destroy();
  }

  function show(
    sender: WebContents,
    preview: HoverPreviewDescriptor,
    placement: 'widget' | 'anchor',
  ): void {
    const signature = hoverPreviewSignature(preview);
    const { width, height } = hoverPreviewWindowSize(preview);
    const display = getDisplayMatching({
      x: Math.round(preview.anchor.x),
      y: Math.round(preview.anchor.y),
      width: Math.max(1, Math.round(preview.anchor.width)),
      height: Math.max(1, Math.round(preview.anchor.height)),
    });
    const owner = ownerFromWebContents(sender);
    const ownerBounds = owner && !owner.isDestroyed()
      ? owner.getBounds()
      : {
        x: preview.anchor.x,
        y: preview.anchor.y,
        width: preview.anchor.width,
        height: preview.anchor.height,
      };
    const { x, y } = placeHoverPreview(preview, placement, display.workArea, ownerBounds);
    const html = buildHoverPreviewDocument(preview);

    const existing = windows.get(sender.id);
    if (existing && !existing.isDestroyed()) {
      if (existing.getBounds().x !== x || existing.getBounds().y !== y) existing.setPosition(x, y);
      if (signatures.get(sender.id) === signature) return;

      signatures.set(sender.id, signature);
      const revision = (revisions.get(sender.id) ?? 0) + 1;
      revisions.set(sender.id, revision);
      const paint = (): void => {
        if (existing.isDestroyed() || windows.get(sender.id) !== existing
          || revisions.get(sender.id) !== revision) return;
        const payload = JSON.stringify({
          imageUrl: preview.imageUrl,
          title: preview.title,
          width: preview.width,
          height: preview.height,
          revision,
        });
        void existing.webContents.executeJavaScript(`(() => {
          const next = ${payload}; window.__previewRevision = next.revision;
          const image = new Image(); image.src = next.imageUrl;
          return image.decode().then(() => {
            if (window.__previewRevision !== next.revision) return false;
            const visible = document.querySelector('img');
            const title = document.querySelector('.title');
            const frame = document.querySelector('.preview');
            if (!visible || !title || !frame) return false;
            title.textContent = next.title;
            visible.src = next.imageUrl;
            visible.style.width = next.width + 'px';
            visible.style.height = next.height + 'px';
            frame.style.width = next.width + 'px';
            frame.style.height = (next.height + ${HOVER_PREVIEW_TITLE_HEIGHT}) + 'px';
            return true;
          }).catch(() => false);
        })();`).then((painted) => {
          if (!painted || existing.isDestroyed() || windows.get(sender.id) !== existing
            || revisions.get(sender.id) !== revision) return;
          const bounds = existing.getBounds();
          if (bounds.x !== x || bounds.y !== y || bounds.width !== width || bounds.height !== height) {
            existing.setBounds({ x, y, width, height });
          }
        }).catch(() => undefined);
      };
      if (existing.webContents.isLoadingMainFrame()) existing.webContents.once('did-finish-load', paint);
      else paint();
      return;
    }

    const previewWindow = createWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    windows.set(sender.id, previewWindow);
    previewWindow.setIgnoreMouseEvents(true);
    previewWindow.setAlwaysOnTop(true, 'floating');
    previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    previewWindow.on('closed', () => {
      if (windows.get(sender.id) === previewWindow) windows.delete(sender.id);
    });
    sender.once('destroyed', () => hide(sender.id));
    signatures.set(sender.id, signature);

    void previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(async () => {
      if (previewWindow.isDestroyed() || windows.get(sender.id) !== previewWindow) return;
      await previewWindow.webContents.executeJavaScript(
        'document.querySelector("img")?.decode().then(() => true, () => false) ?? false',
      ).catch(() => false);
      if (!previewWindow.isDestroyed() && windows.get(sender.id) === previewWindow) {
        previewWindow.showInactive();
      }
    }).catch(() => hide(sender.id));
  }

  function dispose(): void {
    for (const senderId of [...windows.keys()]) hide(senderId);
  }

  return { show, hide, dispose };
}

export type HoverPreviewWindowManager = ReturnType<typeof createHoverPreviewWindowManager>;
