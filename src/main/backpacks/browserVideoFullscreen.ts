import { BaseWindow, screen, type WebContentsView } from 'electron';

/** Owns only the temporary monitor window; the browser tab retains its contents. */
export function createBrowserVideoFullscreen(view: WebContentsView, owner: BaseWindow, restore: () => void) {
  let fullscreen: BaseWindow | null = null;
  const ownerWasFullscreen = owner.isFullScreen();
  const exit = (): void => {
    const window = fullscreen;
    if (!window) return;
    fullscreen = null;
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    if (!owner.isDestroyed() && !ownerWasFullscreen && owner.isFullScreen()) owner.setFullScreen(false);
    restore();
    if (!window.isDestroyed()) window.close();
  };
  const enter = (): void => {
    if (fullscreen || owner.isDestroyed() || view.webContents.isDestroyed()) return;
    const bounds = screen.getDisplayMatching(owner.getBounds()).bounds;
    const window = new BaseWindow({ ...bounds, show: false, frame: false, backgroundColor: '#000000' });
    fullscreen = window;
    owner.contentView.removeChildView(view);
    window.contentView.addChildView(view);
    // Chromium also fullscreens the old owner before delivering the HTML event.
    // The monitor window now owns the view, so return the Papers shell to normal.
    if (!ownerWasFullscreen && owner.isFullScreen()) owner.setFullScreen(false);
    const fit = (): void => {
      if (window.isDestroyed()) return;
      const area = window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: area.width, height: area.height });
    };
    window.on('resize', fit);
    window.on('enter-full-screen', fit);
    window.on('close', () => {
      if (fullscreen !== window) return;
      void view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
      exit();
    });
    window.setFullScreen(true);
    fit();
    window.show();
    window.focus();
    view.webContents.focus();
  };
  view.webContents.on('enter-html-full-screen', enter);
  view.webContents.on('leave-html-full-screen', exit);
  view.webContents.on('before-input-event', (_event, input) => {
    if (fullscreen && input.type === 'keyDown' && input.key === 'Escape') {
      void view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
      exit();
    }
  });
  view.webContents.once('destroyed', exit);
  return { exit, isActive: () => fullscreen !== null };
}
