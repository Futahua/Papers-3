import { BaseWindow, WebContentsView, type WebContents } from 'electron';

import { BACKPACK_PROJECT_SCHEME } from './backpackProjectService';
import { OPAQUE_SURFACE_COLOR, TRANSPARENT_CHILD_SURFACE_COLOR } from '../windowSurface';

export class BackpackProjectRuntime {
  private view: WebContentsView | null = null;
  private projectId: string | null = null;
  private entryUrl: string | null = null;
  private transparent: boolean;

  constructor(
    private readonly window: BaseWindow,
    private readonly preloadPath: string,
    transparent: boolean,
    private readonly onSurfaceClosed?: (projectId: string) => void,
  ) {
    this.transparent = transparent;
  }

  /** The project frame's sender id, so the host can bind it to a project. */
  get senderId(): number | null {
    return this.view ? this.view.webContents.id : null;
  }

  /** The project this surface is currently showing. */
  get liveProjectId(): string | null {
    return this.projectId;
  }

  isSender(sender: WebContents): boolean {
    return this.view !== null && sender.id === this.view.webContents.id;
  }

  entryUrlFor(sender: WebContents, projectId: string): string | null {
    if (!this.view || !this.entryUrl || this.projectId !== projectId || sender.id !== this.view.webContents.id) return null;
    return this.entryUrl;
  }

  /** 019C: the current live project's entry URL for surface sessions (e.g. the
   * compact widget host) that resolve by project identity alone, not by a
   * specific workspace sender. Fails closed when no matching project is live. */
  entryUrlForProject(projectId: string): string | null {
    return this.projectId === projectId ? this.entryUrl : null;
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
    this.projectId = parsed.host;
    this.entryUrl = url;
    view.webContents.on('destroyed', () => {
      if (this.view !== view) return;
      this.view = null;
      this.projectId = null;
      this.entryUrl = null;
      this.onSurfaceClosed?.(parsed.host);
    });
    this.applySurface();
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event, target) => {
      try {
        const next = new URL(target);
        if (next.protocol !== parsed.protocol || next.host !== parsed.host) event.preventDefault();
      } catch {
        event.preventDefault();
      }
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
    const projectId = this.projectId;
    this.view = null;
    this.projectId = null;
    this.entryUrl = null;
    if (projectId) this.onSurfaceClosed?.(projectId);
    // Detach and close the child surface before its parent window is
    // destroyed. hide() can also arrive late — the window teardown used to
    // call it from `closed`, after Electron destroyed the BaseWindow, and a
    // host IPC hide can race a closing window — where the BaseWindow or the
    // WebContents may already be gone. Calling removeChildView/close on a
    // destroyed object throws "Object has been destroyed", so the two
    // lifecycle conditions below are checked explicitly. Nothing else is
    // swallowed: unrelated errors still propagate.
    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(view);
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  }

  private applySurface(): void {
    this.view?.setBackgroundColor(this.transparent ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR);
  }
}
