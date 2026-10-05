import type { BaseWindow, WebContentsView } from 'electron';

/** Lets Chromium fullscreen the owning Papers window while the live tab fills it. */
export function createBrowserVideoFullscreen(view: WebContentsView, owner: BaseWindow, restore: () => void) {
  let active = false;
  const ownerWasFullscreen = owner.isFullScreen();
  const fit = (): void => {
    if (!active || owner.isDestroyed() || view.webContents.isDestroyed()) return;
    const area = owner.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: Math.max(1, area.width), height: Math.max(1, area.height) });
  };
  const stopFollowingOwner = (): void => {
    owner.removeListener('resize', fit);
    owner.removeListener('enter-full-screen', fit);
  };
  const exit = (): void => {
    if (!active) return;
    active = false;
    stopFollowingOwner();
    if (!owner.isDestroyed() && !ownerWasFullscreen && owner.isFullScreen()) owner.setFullScreen(false);
    restore();
  };
  const enter = (): void => {
    if (active || owner.isDestroyed() || view.webContents.isDestroyed()) return;
    active = true;
    owner.on('resize', fit);
    owner.on('enter-full-screen', fit);
    if (!owner.isFullScreen()) owner.setFullScreen(true);
    // Keep the WebContentsView attached to its original owner. Reparenting it
    // during enter-html-full-screen makes Chromium emit leave-html-full-screen
    // and snap the video back into the split pane.
    owner.contentView.addChildView(view);
    fit();
    owner.focus();
    view.webContents.focus();
  };
  view.webContents.on('enter-html-full-screen', enter);
  view.webContents.on('leave-html-full-screen', exit);
  view.webContents.on('before-input-event', (_event, input) => {
    if (active && input.type === 'keyDown' && input.key === 'Escape') {
      void view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
      exit();
    }
  });
  view.webContents.once('destroyed', exit);
  return { exit, isActive: () => active };
}
