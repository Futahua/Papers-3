const DEFAULT_VISIBLE_MS = 2500;
const DEFAULT_FADE_MS = 260;

/** Presents workspace feedback as one replacement-safe toast.
 *
 * Ordinary messages disappear after a readable pause. A new message cancels
 * both timers from the old one, so an earlier warning can never fade or clear
 * a later warning. Interaction modes may ask for a persistent message when the
 * text itself is part of the active controls; explicitly clearing it remains
 * the mode's responsibility. */
export function createStatusToast({
  element,
  visibleMs = DEFAULT_VISIBLE_MS,
  fadeMs = DEFAULT_FADE_MS,
  suppressWarnings = false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let fadeTimer = null;
  let removeTimer = null;
  let revision = 0;
  // Keep the last announced message after its DOM text is removed. A host
  // operation may reject on every autosave attempt; treating each identical
  // rejection as new would restart (or resurrect) the toast forever. An
  // explicit clear or a different message unlocks it.
  let announcedText = '';

  function cancelTimers() {
    if (fadeTimer != null) clearTimer(fadeTimer);
    if (removeTimer != null) clearTimer(removeTimer);
    fadeTimer = null;
    removeTimer = null;
  }

  function show(text = '', { persistent = false, level = 'warning' } = {}) {
    const nextText = text == null ? '' : String(text);
    // The As you Go workspace opts out of transient warning toasts while its
    // form validation and success notices remain available by explicit level.
    if (suppressWarnings && nextText !== '' && level === 'warning') return;
    if (nextText !== '' && nextText === announcedText) return;
    revision += 1;
    const ownRevision = revision;
    cancelTimers();
    element.classList.remove('status-fading', 'status-copied', 'status-success', 'status-info');
    if (level === 'success' || level === 'info') element.classList.add(`status-${level}`);
    element.textContent = nextText;
    announcedText = nextText;
    if (element.textContent === '' || persistent) return;

    const ownText = element.textContent;
    fadeTimer = setTimer(() => {
      fadeTimer = null;
      if (revision !== ownRevision || element.textContent !== ownText) return;
      element.classList.add('status-fading');
      removeTimer = setTimer(() => {
        removeTimer = null;
        if (revision !== ownRevision || element.textContent !== ownText) return;
        element.textContent = '';
        element.classList.remove('status-fading', 'status-copied', 'status-success', 'status-info');
      }, fadeMs);
    }, visibleMs);
  }

  function destroy() {
    revision += 1;
    cancelTimers();
    announcedText = '';
    element.textContent = '';
    element.classList.remove('status-fading', 'status-copied', 'status-success', 'status-info');
  }

  return { show, destroy };
}
