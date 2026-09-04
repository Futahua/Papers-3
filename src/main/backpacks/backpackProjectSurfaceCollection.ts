import { BaseWindow, type WebContents } from 'electron';

import { BackpackProjectRuntime } from './backpackProjectRuntime';

export interface PreparedProjectSurface {
  runtime: BackpackProjectRuntime;
  adopt(): void;
  discard(): void;
}

type RuntimeFactory = (
  surfaceId: string,
  onSurfaceClosed?: (projectId: string) => void,
  onConsoleMessage?: (senderId: number, level: number, message: string, isBootstrap: boolean) => void,
  onLifecycleEvent?: (senderId: number, event: 'did-start-loading' | 'dom-ready' | 'did-finish-load', documentInstanceId?: string) => void,
  onRendererGone?: (senderId: number, reason: string) => void,
) => BackpackProjectRuntime;

function closeRuntime(runtime: BackpackProjectRuntime, report: (error: unknown) => void): void {
  try {
    void Promise.resolve(runtime.hide()).catch(report);
  } catch (caught) {
    report(caught);
  }
}

/**
 * The native project presentations owned by one Papers window.
 *
 * `surfaceId` is the logical tab/pane identity. The collection deliberately
 * does not create or retire that identity; the logical surface registry owns
 * that lifecycle. It only keeps the replaceable native presentation for each
 * live identity, including an empty entry while a renderer is being rebuilt.
 */
export class BackpackProjectSurfaceCollection {
  private readonly runtimes = new Map<string, BackpackProjectRuntime>();

  private notifyIfProjectIsNoLongerPresented(surfaceId: string, projectId: string): void {
    for (const [otherSurfaceId, runtime] of this.runtimes) {
      if (otherSurfaceId !== surfaceId && runtime.liveProjectId === projectId) return;
    }
    this.onSurfaceClosed?.(surfaceId, projectId);
  }

  constructor(
    private readonly window: BaseWindow,
    private readonly preloadPath: string,
    private transparent: boolean,
    private readonly onSurfaceClosed?: (surfaceId: string, projectId: string) => void,
    private readonly createRuntime?: RuntimeFactory,
    private readonly onProjectConsoleMessage?: (surfaceId: string, senderId: number, level: number, message: string, isBootstrap: boolean) => void,
    private readonly onProjectLifecycleEvent?: (surfaceId: string, senderId: number, event: 'did-start-loading' | 'dom-ready' | 'did-finish-load', documentInstanceId?: string) => void,
    private readonly onProjectRendererGone?: (surfaceId: string, senderId: number, reason: string) => void,
  ) {}

  get(surfaceId: string): BackpackProjectRuntime | null {
    return this.runtimes.get(surfaceId) ?? null;
  }

  /** Get or create the native presentation for an already-authorized surface. */
  ensure(surfaceId: string): BackpackProjectRuntime {
    const existing = this.runtimes.get(surfaceId);
    if (existing) return existing;

    const onSurfaceClosed = (projectId: string): void => this.notifyIfProjectIsNoLongerPresented(surfaceId, projectId);
    const onConsoleMessage = (senderId: number, level: number, message: string, isBootstrap: boolean): void => this.onProjectConsoleMessage?.(surfaceId, senderId, level, message, isBootstrap);
    const onLifecycleEvent = (senderId: number, event: 'did-start-loading' | 'dom-ready' | 'did-finish-load', documentInstanceId?: string): void => this.onProjectLifecycleEvent?.(surfaceId, senderId, event, documentInstanceId);
    const onRendererGone = (senderId: number, reason: string): void => this.onProjectRendererGone?.(surfaceId, senderId, reason);
    const runtime = this.createRuntime?.(surfaceId, onSurfaceClosed, onConsoleMessage, onLifecycleEvent, onRendererGone) ?? new BackpackProjectRuntime(
      this.window, this.preloadPath, this.transparent, onSurfaceClosed,
      onConsoleMessage, onLifecycleEvent, onRendererGone,
    );
    this.runtimes.set(surfaceId, runtime);
    return runtime;
  }

  /**
   * Create a native project presentation that is not yet canonical. The
   * caller loads it with `present: false` and establishes authority gating
   * before navigation; adoption is the only point at which it enters this
   * collection and becomes visible. The staged runtime has no close callback,
   * so discard cannot trigger canonical detach/widget cleanup.
   */
  prepare(surfaceId: string): PreparedProjectSurface {
    if (this.runtimes.has(surfaceId)) throw new Error('project surface is already present in this window');
    let lifecycleActive = false;
    const onConsoleMessage = (senderId: number, level: number, message: string, isBootstrap: boolean): void => this.onProjectConsoleMessage?.(surfaceId, senderId, level, message, isBootstrap);
    const onLifecycleEvent = (senderId: number, event: 'did-start-loading' | 'dom-ready' | 'did-finish-load', documentInstanceId?: string): void => this.onProjectLifecycleEvent?.(surfaceId, senderId, event, documentInstanceId);
    const onRendererGone = (senderId: number, reason: string): void => this.onProjectRendererGone?.(surfaceId, senderId, reason);
    const runtime = this.createRuntime?.(surfaceId, (projectId) => {
      if (lifecycleActive) this.notifyIfProjectIsNoLongerPresented(surfaceId, projectId);
    }, onConsoleMessage, onLifecycleEvent, onRendererGone) ?? new BackpackProjectRuntime(
      this.window,
      this.preloadPath,
      this.transparent,
      (projectId) => {
        if (lifecycleActive) this.notifyIfProjectIsNoLongerPresented(surfaceId, projectId);
      },
      onConsoleMessage,
      onLifecycleEvent,
      onRendererGone,
    );
    let adopted = false;
    return {
      runtime,
      adopt: () => {
        if (!adopted) {
          if (this.runtimes.has(surfaceId)) throw new Error('project surface was adopted twice');
          adopted = true;
          this.runtimes.set(surfaceId, runtime);
          lifecycleActive = true;
        }
        // Keep collection insertion idempotent, but retry native presentation
        // after a first addChildView/fit failure. The facade may need this
        // during forward canonicalization after durable compensation fails.
        runtime.present();
      },
      discard: () => {
        if (adopted) {
          // Compensation is intentionally lifecycle-silent even after adopt:
          // it must not look like an ordinary user close to detach/widget
          // ownership observers.
          lifecycleActive = false;
          this.runtimes.delete(surfaceId);
          closeRuntime(runtime, (caught) => {
            console.error(`[workspace-move] staged native discard failed for ${surfaceId}:`, caught);
          });
          return;
        }
        closeRuntime(runtime, (caught) => {
          console.error(`[workspace-move] staged native discard failed for ${surfaceId}:`, caught);
        });
      },
    };
  }

  /** Destroy one attached presentation, leaving logical retirement to its owner. */
  close(surfaceId: string): void {
    const runtime = this.runtimes.get(surfaceId);
    if (!runtime) return;
    this.runtimes.delete(surfaceId);
    // Collection ownership is canonical state. Remove it before native
    // teardown so a late Electron destroyed-object error cannot leave an
    // orphan that blocks a later prepare/adopt for the same logical surface.
    closeRuntime(runtime, (caught) => {
      console.error(`[workspace-move] native close failed for ${surfaceId}:`, caught);
    });
  }

  hide(surfaceId: string): void {
    this.runtimes.get(surfaceId)?.conceal();
  }

  hideAll(): Promise<void> {
    // Window teardown is terminal, unlike hiding one inactive tab.
    return Promise.all([...this.runtimes.values()].map((runtime) => {
      try {
        return Promise.resolve(runtime.hide()).catch((caught) => {
          console.error('[workspace-move] native window teardown failed:', caught);
        });
      } catch (caught) {
        console.error('[workspace-move] native window teardown failed:', caught);
        return Promise.resolve();
      }
    })).then(() => undefined);
  }

  fit(): void {
    for (const runtime of this.runtimes.values()) runtime.fit();
  }

  setBounds(surfaceId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    this.ensure(surfaceId).setBounds(bounds);
  }

  setTransparent(enabled: boolean): void {
    this.transparent = enabled;
    for (const runtime of this.runtimes.values()) runtime.setTransparent(enabled);
  }

  isSender(sender: WebContents): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.isSender(sender)) return true;
    }
    return false;
  }

  /**
   * Auxiliary surfaces are still keyed by project and owner window. If two
   * logical surfaces show one project, either live presentation has the same
   * project-owned entry origin, so the first live match is sufficient.
   */
  entryUrlForProject(projectId: string): string | null {
    for (const runtime of this.runtimes.values()) {
      const entryUrl = runtime.entryUrlForProject(projectId);
      if (entryUrl) return entryUrl;
    }
    return null;
  }

  all(): BackpackProjectRuntime[] {
    return [...this.runtimes.values()];
  }
}
