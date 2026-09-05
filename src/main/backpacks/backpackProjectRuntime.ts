import { BaseWindow, WebContentsView, type NativeImage, type WebContents } from 'electron';

import { BACKPACK_PROJECT_SCHEME } from './backpackProjectService';
import { OPAQUE_SURFACE_COLOR, TRANSPARENT_CHILD_SURFACE_COLOR } from '../windowSurface';
import { VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL } from '@shared/visualSemanticKeyConstants';
import { VISUAL_DOCUMENT_INSTANCE_CHANNEL } from '@shared/visualSemanticKeyConstants';
import { randomUUID } from 'node:crypto';

export class BackpackProjectRuntime {
  private view: WebContentsView | null = null;
  private projectId: string | null = null;
  private entryUrl: string | null = null;
  private transparent: boolean;
  private bounds: { x: number; y: number; width: number; height: number } | null = null;
  private presented = false;
  private hidePromise: Promise<void> | null = null;
  private showPromise: Promise<void> | null = null;
  private readonly frameDestroyedCallbacks = new Map<number, () => void>();
  private readonly observedDestroyedFrames = new Set<number>();

  constructor(
    private readonly window: BaseWindow,
    private readonly preloadPath: string,
    transparent: boolean,
    private readonly onSurfaceClosed?: (projectId: string) => void,
    private readonly onConsoleMessage?: (senderId: number, level: number, message: string, isBootstrap: boolean) => void,
    private readonly onLifecycleEvent?: (senderId: number, event: 'did-start-loading' | 'dom-ready' | 'did-finish-load', documentInstanceId?: string) => void,
    private readonly onRendererGone?: (senderId: number, reason: string) => void,
    private readonly onTitleChanged?: (senderId: number, title: string) => void,
  ) {
    this.transparent = transparent;
  }

  /**
   * Run `onDestroyed` when the frame with this sender id goes away. `show()`
   * hides a live surface before replacing it, so a caller that bound the frame
   * needs to hear about the death or a dead sender id stays bound.
   */
  onFrameDestroyed(senderId: number, onDestroyed: () => void): void {
    const view = this.view;
    if (!view || view.webContents.id !== senderId) {
      onDestroyed();
      return;
    }
    this.frameDestroyedCallbacks.set(senderId, onDestroyed);
    if (this.observedDestroyedFrames.has(senderId)) return;
    this.observedDestroyedFrames.add(senderId);
    view.webContents.once('destroyed', () => {
      this.observedDestroyedFrames.delete(senderId);
      const callback = this.frameDestroyedCallbacks.get(senderId);
      this.frameDestroyedCallbacks.delete(senderId);
      callback?.();
    });
  }

  /** The project frame's sender id, so the host can bind it to a project. */
  get senderId(): number | null {
    return this.view ? this.view.webContents.id : null;
  }

  get webContents(): WebContents | null {
    return this.view?.webContents ?? null;
  }

  /** The project this surface is currently showing. */
  get liveProjectId(): string | null {
    return this.projectId;
  }

  get liveEntryUrl(): string | null {
    return this.entryUrl;
  }

  get isPresented(): boolean {
    return this.presented;
  }

  /** Ask the already-installed predefined project observer to resend its
   * current fixed semantic-key set after a renderer becomes canonical. */
  refreshVisualSemanticKeys(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send(VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL);
  }

  async capturePage(): Promise<NativeImage> {
    if (!this.view || this.view.webContents.isDestroyed()) throw new Error('project renderer is unavailable');
    return this.view.webContents.capturePage();
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

  async show(url: string, options: { present?: boolean; beforeLoad?: (senderId: number) => void } = {}): Promise<void> {
    if (this.showPromise) await this.showPromise;
    const pending = this.showInternal(url, options);
    this.showPromise = pending;
    try {
      await pending;
    } finally {
      if (this.showPromise === pending) this.showPromise = null;
    }
  }

  private async showInternal(url: string, options: { present?: boolean; beforeLoad?: (senderId: number) => void } = {}): Promise<void> {
    const present = options.present ?? true;
    const parsed = new URL(url);
    if (parsed.protocol !== `${BACKPACK_PROJECT_SCHEME}:`) throw new Error('Only a bound Backpack project may use the project surface.');
    if (this.hidePromise) await this.hidePromise;
    if (this.view && this.projectId === parsed.host && this.entryUrl === url) {
      if (present) this.present();
      this.fit();
      this.applySurface();
      return;
    }
    await this.hide();
    const view = new WebContentsView({ webPreferences: {
      preload: this.preloadPath, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webviewTag: false, transparent: true,
    } });
    this.view = view;
    this.projectId = parsed.host;
    this.entryUrl = url;
    this.presented = present;
    view.webContents.on('destroyed', () => {
      if (this.view !== view) return;
      this.view = null;
      this.projectId = null;
      this.entryUrl = null;
      this.presented = false;
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
    let capturingBootstrapConsole = true;
    view.webContents.on('did-start-loading', () => this.onLifecycleEvent?.(view.webContents.id, 'did-start-loading'));
    view.webContents.on('dom-ready', () => {
      capturingBootstrapConsole = false;
      this.onLifecycleEvent?.(view.webContents.id, 'dom-ready');
    });
    view.webContents.on('did-finish-load', () => {
      const documentInstanceId = randomUUID();
      view.webContents.send(VISUAL_DOCUMENT_INSTANCE_CHANNEL, { documentInstanceId });
      this.onLifecycleEvent?.(view.webContents.id, 'did-finish-load', documentInstanceId);
    });
    view.webContents.on('page-title-updated', (_event, title) => {
      this.onTitleChanged?.(view.webContents.id, title);
    });
    view.webContents.on('console-message', (...args: unknown[]) => {
      const level = args[1];
      const message = args[2];
      if (typeof level === 'number' && typeof message === 'string' && message.length > 0) {
        this.onConsoleMessage?.(view.webContents.id, level, message, capturingBootstrapConsole);
      }
    });
    view.webContents.on('render-process-gone', (...args: unknown[]) => {
      const details = args[1];
      const reason = details !== null && typeof details === 'object' && typeof (details as { reason?: unknown }).reason === 'string'
        ? (details as { reason: string }).reason
        : 'unknown';
      this.onRendererGone?.(view.webContents.id, reason);
    });
    options.beforeLoad?.(view.webContents.id);
    if (present) this.window.contentView.addChildView(view);
    this.fit();
    await view.webContents.loadURL(url);
    this.applySurface();
  }

  /** Attach a prepared view to its owning window at canonical adoption. */
  present(): void {
    if (!this.view || this.presented || this.window.isDestroyed()) return;
    this.window.contentView.addChildView(this.view);
    this.presented = true;
    this.fit();
  }

  /** Re-add an already-presented native view at the top of its window's child
   * stack so host-renderer popovers can paint above it. Bounds and renderer
   * identity are unchanged. */
  raise(): void {
    if (!this.view || !this.presented || this.window.isDestroyed()) return;
    this.window.contentView.addChildView(this.view);
  }

  /** Remove the native view from composition without ending its renderer. */
  conceal(): void {
    if (!this.view || !this.presented) return;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    this.presented = false;
  }

  fit(): void {
    if (!this.view) return;
    if (this.bounds) {
      this.view.setBounds(this.bounds);
      return;
    }
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 40, width, height: Math.max(0, height - 40) });
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...bounds };
    this.fit();
  }

  async hide(options: { restoreOnFlushFailure?: boolean } = {}): Promise<void> {
    if (this.hidePromise) return this.hidePromise;
    const view = this.view;
    if (!view) return;
    const projectId = this.projectId;
    this.presented = false;
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
    const close = async (): Promise<void> => {
      // Keep the live sender identity until the page has completed its own
      // checked save. Project IPC authorization is sender-based, so retiring
      // this.view before the hook would make the close flush fail closed.
      if (!view.webContents.isDestroyed()) {
        try {
          const outcome = await Promise.race([
            view.webContents.executeJavaScript(
              'globalThis.__papersFlushBeforeClose?.()',
              true,
            ).then(() => 'flushed' as const),
            new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2500)),
          ]);
          if (outcome === 'timeout') throw new Error('project close flush timed out before renderer close');
        } catch (caught) {
          throw caught instanceof Error ? caught : new Error(String(caught));
        }
      }
      if (this.view === view) {
        this.view = null;
        this.projectId = null;
        this.entryUrl = null;
        if (projectId) this.onSurfaceClosed?.(projectId);
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    };
    const pending = close().catch((caught) => {
      if (this.view === view && options.restoreOnFlushFailure !== false) {
        // Voluntary replacement must remain recoverable when the renderer
        // cannot flush. The view is detached above but still alive; restore it
        // so callers can keep using the old tab and retry.
        if (!this.window.isDestroyed()) {
          this.window.contentView.addChildView(view);
          this.presented = true;
          this.fit();
        }
      } else if (this.view === view) {
        // Terminal teardown is best-effort: do not leave an attached native
        // view orphaned when its final flush fails.
        this.view = null;
        this.projectId = null;
        this.entryUrl = null;
        this.presented = false;
        if (projectId) this.onSurfaceClosed?.(projectId);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      }
      throw caught;
    }).finally(() => {
      if (this.hidePromise === pending) this.hidePromise = null;
    });
    this.hidePromise = pending;
    return pending;
  }

  private applySurface(): void {
    this.view?.setBackgroundColor(this.transparent ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR);
  }
}
