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

/**
 * Two different senders act for one project, and they are not
 * interchangeable. The `host` surface is the Papers renderer that opened the
 * project; the `project` surface is the Backpack's own frame inside it.
 *
 * Without this distinction "every sender for project X" is the only question
 * the registry can answer, and that is the wrong question whenever the right
 * one is "which window did this come from" -- two windows may legitimately
 * show the same project.
 */
export type SurfaceKind = 'host' | 'project';

export interface SurfaceContext {
  /** The Backpack whose project this surface is showing. */
  projectId: string;
  /** Identifies the native window a surface belongs to, so a window can be
   * torn down without hunting for its surfaces. */
  windowId: number;
  kind: SurfaceKind;
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
  /** The Papers renderer of one window. This is what a project frame's request
   * must be answered through: its OWN window's host, never every host showing
   * the same project. */
  hostSenderForWindow(windowId: number): number | null;
  projectSendersForProject(projectId: string): number[];
  hostSendersForProject(projectId: string): number[];
  readonly size: number;
}

export function createSurfaceContextRegistry(): SurfaceContextRegistry {
  const bySender = new Map<number, SurfaceContext>();

  function sendersWhere(match: (context: SurfaceContext) => boolean): number[] {
    const found: number[] = [];
    for (const [senderId, context] of bySender) {
      if (match(context)) found.push(senderId);
    }
    return found;
  }

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
      return sendersWhere((context) => context.projectId === projectId);
    },

    hostSenderForWindow(windowId) {
      for (const [senderId, context] of bySender) {
        if (context.windowId === windowId && context.kind === 'host') return senderId;
      }
      return null;
    },

    projectSendersForProject(projectId) {
      return sendersWhere((context) => context.projectId === projectId && context.kind === 'project');
    },

    hostSendersForProject(projectId) {
      return sendersWhere((context) => context.projectId === projectId && context.kind === 'host');
    },

    get size() {
      return bySender.size;
    },
  };
}
