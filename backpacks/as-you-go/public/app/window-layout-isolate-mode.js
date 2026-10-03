/** Ephemeral per-layout isolate-mode interaction state.
 *
 * The mode is deliberately not durable layout data. A plain member click
 * replaces the target set; Ctrl-click only adds to it. Returning null means
 * ordinary member behavior should continue because the mode is off.
 */
export function createWindowLayoutIsolateMode() {
  const targetsByLayout = new Map();

  return {
    isActive(layoutId) {
      return targetsByLayout.has(layoutId);
    },
    toggle(layoutId) {
      if (targetsByLayout.has(layoutId)) {
        targetsByLayout.delete(layoutId);
        return false;
      }
      targetsByLayout.set(layoutId, new Set());
      return true;
    },
    click(layoutId, memberId, additive = false) {
      if (!targetsByLayout.has(layoutId)) return null;
      const targets = additive
        ? new Set(targetsByLayout.get(layoutId))
        : new Set();
      targets.add(memberId);
      targetsByLayout.set(layoutId, targets);
      return [...targets];
    },
  };
}
