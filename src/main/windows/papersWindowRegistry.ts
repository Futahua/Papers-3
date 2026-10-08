

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
  /**
   * The Backpack this window has entered. Per window, because two windows may
   * be in different Backpacks -- that is the point of having two. This is a
   * legacy/no-surface projection; an active project surface is authoritative
   * when one exists.
   */
  enteredBackpackId: string | null;
  /** The focused logical project surface in this window, if any. */
  activeSurfaceId: string | null;
  /**
   * The Backpack this window may restore at startup, if any. Set when the
   * window is created: the first window at launch may carry the persisted
   * most-recent Backpack; a window opened later carries null, so New Window
   * gives a fresh window rather than a second copy of the last one.
   */
  restoreBackpackId: string | null;
}

export interface PapersWindowRegistry<Owned> {
  add(windowId: number, owned: Owned, restoreBackpackId?: string | null): PapersWindowContext<Owned>;
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
  /** What this window has entered, and the setter for entering/leaving. */
  enteredBackpack(windowId: number): string | null;
  setEnteredBackpack(windowId: number, backpackId: string | null): void;
  activeSurfaceId(windowId: number): string | null;
  setActiveSurfaceId(windowId: number, surfaceId: string | null): void;
  /** The startup restore candidate for this window; null for a window opened
   * after launch. Reading it does not consume the persisted MRU -- the
   * registry that stores that stays a dumb store. */
  restoreBackpack(windowId: number): string | null;
  /**
   * Clear a Backpack from every window that entered it. Correct only when the
   * Backpack itself has become unavailable (archived or removed); one window
   * leaving its own Backpack must never touch another's.
   */
  clearEnteredBackpackEverywhere(backpackId: string): void;
  /** The window a sender belongs to, or null when it belongs to none. Never a
   * guess: an unknown sender must be refused, not attributed to whichever
   * window happens to exist. */
  windowForSender(senderId: number): number | null;
  readonly windowIds: number[];
  readonly size: number;
}

export function createPapersWindowRegistry<Owned>(): PapersWindowRegistry<Owned> {
  const byWindow = new Map<number, PapersWindowContext<Owned>>();

  return {
    add(windowId, owned, restoreBackpackId = null) {
      const existing = byWindow.get(windowId);
      if (existing) return existing;
      const context: PapersWindowContext<Owned> = {
        windowId,
        hostSenderId: null,
        owned,
        enteredBackpackId: null,
        activeSurfaceId: null,
        restoreBackpackId,
      };
      byWindow.set(windowId, context);
      return context;
    },

    enteredBackpack(windowId) {
      return byWindow.get(windowId)?.enteredBackpackId ?? null;
    },

    setEnteredBackpack(windowId, backpackId) {
      const context = byWindow.get(windowId);
      if (!context) return;
      context.enteredBackpackId = backpackId;
    },

    activeSurfaceId(windowId) {
      return byWindow.get(windowId)?.activeSurfaceId ?? null;
    },

    setActiveSurfaceId(windowId, surfaceId) {
      const context = byWindow.get(windowId);
      if (!context) return;
      context.activeSurfaceId = surfaceId;
    },

    restoreBackpack(windowId) {
      return byWindow.get(windowId)?.restoreBackpackId ?? null;
    },

    clearEnteredBackpackEverywhere(backpackId) {
      for (const context of byWindow.values()) {
        if (context.enteredBackpackId === backpackId) context.enteredBackpackId = null;
      }
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
  };
}
