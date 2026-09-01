/**
 * Phase 1B: the Papers windows that exist, and what belongs to each.
 *
 * Phase 1A made every project request resolve through its own sender, but the
 * answer to "which window is that sender in?" was still a single-window stub.
 * This is the real answer, and it is the piece that lets a second window exist
 * without the first one's requests reaching it.
 *
 * The division matters more than the mechanism. A Papers window owns what is
 * genuinely per-window -- its native window, its host renderer, the project
 * surface it is showing. Everything else stays application-level: the Backpack
 * registry, the project service, Delegate Wave, the updater, capabilities, and
 * the one Hermes backend. The existence of application globals is not evidence
 * that they should be duplicated; only the things whose semantics are
 * per-window move.
 *
 * Hermes is the clearest case. There is one backend and one Desktop, and the
 * dock has exactly one owner at a time (D-021). That owner is recorded here
 * because it is a relationship between Hermes and a window, and it changes
 * only when the creator presses Dock -- never because a window took focus.
 */

/**
 * `Owned` is whatever this window genuinely owns -- its native window, its
 * host view, its project runtime. It is a type parameter so this module stays
 * pure and testable: the registry never needs to know what an Electron window
 * is, and the lifecycle rules can be tested without one.
 */
export interface PapersWindowContext<Owned> {
  /** The native window's id. Stable for the window's lifetime. */
  windowId: number;
  /** The Papers renderer for this window, once it exists. */
  hostSenderId: number | null;
  /** The per-window objects. Returned by reference -- they are the live
   * things, not a description of them. */
  owned: Owned;
}

export interface PapersWindowRegistry<Owned> {
  add(windowId: number, owned: Owned): PapersWindowContext<Owned>;
  remove(windowId: number): void;
  has(windowId: number): boolean;
  get(windowId: number): PapersWindowContext<Owned> | null;
  /** Every live context, for the events that genuinely go to all windows. */
  all(): Array<PapersWindowContext<Owned>>;
  /** What the window this sender belongs to owns, or null. The resolution a
   * per-window operation needs: sender -> window -> its own runtime. */
  ownedForSender(senderId: number): Owned | null;
  /** Record this window's Papers renderer. */
  setHostSender(windowId: number, senderId: number | null): void;
  /** The window a sender belongs to, or null when it belongs to none. Never a
   * guess: an unknown sender must be refused, not attributed to whichever
   * window happens to exist. */
  windowForSender(senderId: number): number | null;
  readonly windowIds: number[];
  readonly size: number;

  /**
   * Which window currently owns the docked Hermes, if any.
   *
   * Ownership transfers only on a deliberate Dock press, never on focus -- a
   * single global Hermes window that followed focus would jump between Papers
   * windows as the creator clicked around, moving a live agent session by
   * accident. A detached Hermes belongs to no window.
   */
  hermesDockOwner(): number | null;
  setHermesDockOwner(windowId: number | null): void;
}

export function createPapersWindowRegistry<Owned>(): PapersWindowRegistry<Owned> {
  const byWindow = new Map<number, PapersWindowContext<Owned>>();
  let hermesOwner: number | null = null;

  return {
    add(windowId, owned) {
      const existing = byWindow.get(windowId);
      if (existing) return existing;
      const context: PapersWindowContext<Owned> = { windowId, hostSenderId: null, owned };
      byWindow.set(windowId, context);
      return context;
    },

    all() {
      return [...byWindow.values()].map((context) => ({ ...context }));
    },

    ownedForSender(senderId) {
      for (const context of byWindow.values()) {
        if (context.hostSenderId === senderId) return context.owned;
      }
      return null;
    },

    remove(windowId) {
      byWindow.delete(windowId);
      // A closed window cannot hold the dock. Hermes itself keeps running --
      // Papers owns the docking connection, not Hermes's lifetime -- so this
      // releases ownership rather than shutting anything down.
      if (hermesOwner === windowId) hermesOwner = null;
    },

    has(windowId) {
      return byWindow.has(windowId);
    },

    get(windowId) {
      const found = byWindow.get(windowId);
      return found ? { ...found } : null;
    },

    setHostSender(windowId, senderId) {
      const context = byWindow.get(windowId);
      if (!context) return;
      context.hostSenderId = senderId;
    },

    windowForSender(senderId) {
      for (const context of byWindow.values()) {
        if (context.hostSenderId === senderId) return context.windowId;
      }
      return null;
    },

    get windowIds() {
      return [...byWindow.keys()];
    },

    get size() {
      return byWindow.size;
    },

    hermesDockOwner() {
      return hermesOwner;
    },

    setHermesDockOwner(windowId) {
      // Only a live window may own the dock; anything else releases it.
      hermesOwner = windowId !== null && byWindow.has(windowId) ? windowId : null;
    },
  };
}
