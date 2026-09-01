import { BaseWindow, type WebContents } from 'electron';

import { BackpackProjectRuntime } from './backpackProjectRuntime';

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
    private readonly createRuntime?: (surfaceId: string) => BackpackProjectRuntime,
  ) {}

  get(surfaceId: string): BackpackProjectRuntime | null {
    return this.runtimes.get(surfaceId) ?? null;
  }

  /** Get or create the native presentation for an already-authorized surface. */
  ensure(surfaceId: string): BackpackProjectRuntime {
    const existing = this.runtimes.get(surfaceId);
    if (existing) return existing;

    const runtime = this.createRuntime?.(surfaceId) ?? new BackpackProjectRuntime(
      this.window,
      this.preloadPath,
      this.transparent,
      (projectId) => this.notifyIfProjectIsNoLongerPresented(surfaceId, projectId),
    );
    this.runtimes.set(surfaceId, runtime);
    return runtime;
  }

  /** Destroy one attached presentation, leaving logical retirement to its owner. */
  close(surfaceId: string): void {
    const runtime = this.runtimes.get(surfaceId);
    if (!runtime) return;
    runtime.hide();
    this.runtimes.delete(surfaceId);
  }

  hide(surfaceId: string): void {
    this.runtimes.get(surfaceId)?.hide();
  }

  hideAll(): void {
    for (const runtime of this.runtimes.values()) runtime.hide();
  }

  fit(): void {
    for (const runtime of this.runtimes.values()) runtime.fit();
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
