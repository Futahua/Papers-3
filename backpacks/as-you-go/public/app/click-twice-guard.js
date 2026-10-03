/** A tiny confirmation guard for destructive widget actions. The second
 * uninterrupted activation confirms; pointer leave/window blur reset it. */
export function createClickTwiceGuard() {
  let armed = false;
  return {
    activate() {
      if (armed) {
        armed = false;
        return { confirmed: true, armed: false };
      }
      armed = true;
      return { confirmed: false, armed: true };
    },
    reset() { armed = false; },
    isArmed() { return armed; },
  };
}
