import { BaseWindow, WebContentsView, type WebContents } from 'electron';

import { BACKPACK_PROJECT_SCHEME } from './backpackProjectService';
import { OPAQUE_SURFACE_COLOR, TRANSPARENT_CHILD_SURFACE_COLOR } from '../windowSurface';

export class BackpackProjectRuntime {
  private view: WebContentsView | null = null;
  private transparent: boolean;

  constructor(private readonly window: BaseWindow, private readonly preloadPath: string, transparent: boolean) {
    this.transparent = transparent;
  }

  isSender(sender: WebContents): boolean {
    return this.view !== null && sender.id === this.view.webContents.id;
  }

  setTransparent(enabled: boolean): void {
    this.transparent = enabled;
    this.applySurface();
  }

  async show(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== `${BACKPACK_PROJECT_SCHEME}:`) throw new Error('Only a bound Backpack project may use the project surface.');
    this.hide();
    const view = new WebContentsView({ webPreferences: {
      preload: this.preloadPath, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webviewTag: false, transparent: true,
    } });
    this.view = view;
    this.applySurface();
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== parsed.origin) event.preventDefault();
    });
    this.window.contentView.addChildView(view);
    this.fit();
    await view.webContents.loadURL(url);
    this.applySurface();
  }

  fit(): void {
    if (!this.view) return;
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 40, width, height: Math.max(0, height - 40) });
  }

  hide(): void {
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.window.contentView.removeChildView(view);
    view.webContents.close();
  }

  private applySurface(): void {
    this.view?.setBackgroundColor(this.transparent ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR);
  }
}
