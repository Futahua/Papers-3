/**
 * Distinguishes a creator-driven native edge resize from incidental renderer
 * resize events caused by movement, DPI changes, or programmatic fitting.
 * BrowserWindow will-resize refreshes this short authority lease; only resize
 * events landing inside the lease may persist a new width.
 */
export function createWidgetResizeAuthority({ now = () => performance.now(), leaseMs = 500 } = {}) {
  let validUntil = 0;
  return {
    noteNativeResize() {
      validUntil = now() + leaseMs;
    },
    mayPersistResize() {
      return now() <= validUntil;
    },
    clear() {
      validUntil = 0;
    },
  };
}
