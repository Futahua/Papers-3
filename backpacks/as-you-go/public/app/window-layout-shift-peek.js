/** Pure transition planner for the layout member Shift Peek gesture. */
export function planWindowLayoutShiftPeekTransition(source, event, {
  held = false,
  member = null,
  relatedMember = null,
} = {}) {
  if (!event || typeof event !== 'object') return { handled: false, held, begin: null, end: false };

  if (source === 'keydown') {
    if (event.key !== 'Shift' || event.repeat) return { handled: false, held, begin: null, end: false };
    return { handled: true, held: true, begin: member, end: false };
  }
  if (source === 'keyup') {
    if (event.key !== 'Shift') return { handled: false, held, begin: null, end: false };
    return { handled: true, held: false, begin: null, end: true };
  }
  if (source === 'blur') return { handled: true, held: false, begin: null, end: true };
  if (source === 'memberleave') {
    // The pointer left a member. Blank space INSIDE the widget keeps the last
    // Peek while Shift is held - the pointer drifts between icons, and ending
    // there flashed the desktop and re-peeked on the next icon. Leaving the
    // widget itself, or releasing Shift, still ends it.
    const keep = held && event.leftWidget !== true;
    return { handled: true, held, begin: null, end: !keep };
  }
  if (source === 'hover') {
    if (member && member !== relatedMember && (event.shiftKey || held)) {
      return { handled: true, held: true, begin: member, end: false };
    }
    return { handled: false, held, begin: null, end: false };
  }
  if (source === 'pointermove') {
    if (event.shiftKey && member) return { handled: true, held: true, begin: member, end: false };
    if (!event.shiftKey && held) return { handled: true, held: false, begin: null, end: true };
  }
  return { handled: false, held, begin: null, end: false };
}
