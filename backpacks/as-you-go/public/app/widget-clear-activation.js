function handleWidgetDestructiveActivation(event, button, guard, action, armedClass) {
  event?.preventDefault?.();
  if (!button || !guard || typeof action !== 'function') return 'ignored';
  // Enter/Space synthesize click events with detail 0 on a focused button.
  // This control is intentionally a two-pointer-click confirmation, so a key
  // press can never become the second destructive activation.
  if (!Number.isFinite(event?.detail) || event.detail <= 0) {
    button.blur?.();
    return 'ignored-keyboard';
  }

  const activation = guard.activate();
  if (!activation.confirmed) {
    button.classList?.add(armedClass);
    button.blur?.();
    return 'armed';
  }

  guard.reset();
  button.classList?.remove(armedClass);
  button.blur?.();
  action();
  return 'confirmed';
}

/** Process a widget clear only for two consecutive real pointer clicks. */
export function handleWidgetClearActivation(event, button, guard, clear) {
  const outcome = handleWidgetDestructiveActivation(event, button, guard, clear, 'is-clear-armed');
  return outcome === 'confirmed' ? 'cleared' : outcome;
}

/** Process a widget delete only for two consecutive real pointer clicks. */
export function handleWidgetDeleteActivation(event, button, guard, remove) {
  const outcome = handleWidgetDestructiveActivation(event, button, guard, remove, 'is-delete-armed');
  return outcome === 'confirmed' ? 'deleted' : outcome;
}
