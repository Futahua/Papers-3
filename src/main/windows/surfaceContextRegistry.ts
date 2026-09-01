/**
 * Phase 1A: which project a request actually came from.
 *
 * Until now the main process answered "which Backpack project is open?" with a
 * single application-global. With one window that was indistinguishable from
 * the truth. With two it is a data-loss bug: window A asks to save its board,
 * the global says the project window B most recently opened, and A's document
 * is written into B's file. `saveBackpackProjectState(rawState)` carries no
 * project identity at all, so nothing downstream can notice.
 *
 * The sender always knew the answer. Every IPC request arrives from a specific
 * `WebContents` — a host view or a project frame — and each of those belongs to
 * exactly one project. This registry is that binding, and nothing here consults
 * ambient state: a request either resolves through its own sender or it is
 * refused.
 *
 * Global services stay global. This is only about whose request it is.
 */

export interface SurfaceContext {
  /** The Backpack whose project this surface is showing. */
  projectId: string;
  /** Identifies the native window a surface belongs to, so a window can be
   * torn down without hunting for its surfaces. */
  windowId: number;
}

export interface SurfaceContextRegistry {
  bind(senderId: number, context: SurfaceContext): void;
  unbind(senderId: number): void;
  unbindWindow(windowId: number): void;
  unbindProject(projectId: string): void;
  /** The project this sender may act for, or null. Never a guess. */
  projectForSender(senderId: number): string | null;
  contextForSender(senderId: number): SurfaceContext | null;
  /** Every sender currently bound to a project — used to notify exactly the
   * surfaces that care, instead of broadcasting to whoever is listening. */
  sendersForProject(projectId: string): number[];
  readonly size: number;
}

export function createSurfaceContextRegistry(): SurfaceContextRegistry {
  const bySender = new Map<number, SurfaceContext>();

  return {
    bind(senderId, context) {
      // Rebinding one sender to a different project is legitimate: a window
      // leaves one Backpack and enters another through the same view.
      bySender.set(senderId, { ...context });
    },

    unbind(senderId) {
      bySender.delete(senderId);
    },

    unbindWindow(windowId) {
      for (const [senderId, context] of bySender) {
        if (context.windowId === windowId) bySender.delete(senderId);
      }
    },

    unbindProject(projectId) {
      for (const [senderId, context] of bySender) {
        if (context.projectId === projectId) bySender.delete(senderId);
      }
    },

    projectForSender(senderId) {
      return bySender.get(senderId)?.projectId ?? null;
    },

    contextForSender(senderId) {
      const found = bySender.get(senderId);
      return found ? { ...found } : null;
    },

    sendersForProject(projectId) {
      const found: number[] = [];
      for (const [senderId, context] of bySender) {
        if (context.projectId === projectId) found.push(senderId);
      }
      return found;
    },

    get size() {
      return bySender.size;
    },
  };
}
