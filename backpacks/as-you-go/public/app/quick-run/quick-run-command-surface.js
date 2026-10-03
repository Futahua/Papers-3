/**
 * Quick Run — the launcher overlay's marker and its one event.
 *
 * The creator's correction, and it is the whole reason this module exists rather than the old one: Alt+A is a
 * LAUNCHER, not a window switcher. "they all work, but my idea of alt a is not to bring papers forward" -
 * the command surface appears on top of whatever application they are using, they type, they press Enter, it
 * vanishes, and the application they came from never loses its place. Papers does not come forward at all.
 *
 * So the host opens a 640x220 always-on-top window on this project's URL with a marker on it, and the
 * marker - not an event - is what says "you are the command surface now". There is no second page and no
 * second product: the same code serves the canvas, the in-app chord and this overlay, and the only thing the
 * marker changes is what is rendered and two rules about focus and Escape. Every divergence that remains is
 * named at its implementation, so two versions cannot drift apart quietly.
 *
 * The withdrawn contract is worth recording, because it had a subtly different shape: the host used to bring
 * Papers to the front and relay `papers:project:global-invoke`, so the project could only ever OPEN a surface
 * in a window the host had already raised. This one arrives in a window that already exists.
 */

/** The query parameter the host puts on the URL. Same mechanism as the compact widget marker. */
export const COMMAND_SURFACE_PARAM = 'papers-surface';

/** The host's own identifier for that parameter, kept so both sides can be read side by side. */
export const COMMAND_SURFACE_MARKER = COMMAND_SURFACE_PARAM;

/** The value that means "this window is the command surface". */
export const COMMAND_SURFACE_MODE = 'command-surface';

/** The project-side name of the host's invoke channel, as the preload relays it. */
export const COMMAND_SURFACE_INVOKE_CHANNEL = 'papers:project:command-surface-invoke';

/**
 * WHY THE LAUNCHER HAS NO ITEMS — diagnosed, host-side, one gate. Read this before touching the load path.
 *
 * Measured on the creator's installed build (4a6120a), by making the failure say itself out loud in the
 * overlay: every project request from the launcher is refused with
 *
 *   Error invoking remote method 'host:backpack-project:state-load':
 *   Error: host channel called from non-host sender
 *
 * That is thrown in `src/main/ipc/hostIpc.ts` before the facade is reached, by a guard that admits a sender
 * when `isHostSender(sender)` OR `isBackpackProjectSender(sender)`. The launcher is neither. The predicate
 * behind the second (`src/main/backpacks/backpackSurfaceRegistry.ts`) admits exactly three things: the live
 * workspace frame, a sender in `detachRegistry` with kind `detached`, or a sender in `widgetRegistry` with
 * kind `compact-widget` — and the launcher window is registered in NEITHER registry. It is only bound to
 * `surfaceContexts` (by `bindOwnedProjectSurface(overlayWindow, projectId, 'widget', …)`), which is a
 * different registry, consulted by a different check (`requireProjectForSender`), and that check is reached
 * only after this guard has already thrown.
 *
 * What that means in full, because it is wider than the empty box:
 *   - `state-load` is refused, so the surface has no items to search (what the creator saw);
 *   - `launch-shortcut`, `copy-text`, `state-save-checked` and every other project request are refused by the
 *     same rule, so running a result from the launcher would fail even with the items in hand.
 *
 * So the bar the creator set — items appear AND are runnable — needs one host-side change: admit the
 * launcher's sender in `isAllowedProjectSurfaceSender` (a third registration kind alongside detached and
 * compact-widget, registered where the window is created). Nothing on this side can or should work around it:
 * a second store, a cached copy or a side channel would all be a second source of items, which is exactly
 * what the contract forbids. The retries this project does make (one bounded one at boot, one per invocation
 * while nothing has ever loaded) are the most this side can honestly do, and they mean the feature starts
 * working the moment that gate admits the sender — without anyone reopening the overlay.
 */


/** Why an invoked event was left alone. */
export const QUICK_RUN_INVOKE_IGNORE = Object.freeze({
  /** Not the chord: the same wire carries other neutral events. */
  reason: 'not-a-command-surface-invocation',
  /** Nothing to read a reason from. */
  malformed: 'the-event-carried-no-payload',
});

/** The only `reason` the host sends for this event, and therefore the only one acted on. */
export const COMMAND_SURFACE_INVOKE_REASON = 'global-accelerator';

function validCaptureId(value) {
  // Native hook ids are decimal, while the host's ordered OPEN/APPEND handoff
  // ids are namespaced (`papers-<time>-<sequence>`). The receiver only needs
  // to validate a bounded opaque correlation token; requiring digits here
  // silently discarded the seeded first character from host-originated input.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * Which surface this page is, read from its own URL.
 *
 * The default is the workspace, deliberately: rendering a chrome-less palette where the canvas should be is
 * the worse of the two mistakes, so anything that is not exactly the marker - absent, misspelled, another
 * surface kind, an unparseable URL - is the ordinary canvas.
 */
export function commandSurfaceModeFromUrl(href) {
  if (typeof href !== 'string' || href === '') return 'workspace';
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return 'workspace';
  }
  return parsed.searchParams.get(COMMAND_SURFACE_PARAM) === COMMAND_SURFACE_MODE ? 'overlay' : 'workspace';
}

/**
 * What a relayed invocation means: `{ kind: 'focus-and-clear' }`, or `{ kind: 'ignore', reason }`.
 *
 * Focus and clear, NOT open. The marker already opened the surface, and the creator may press the chord
 * again while the overlay is up - the sentence that governs it is that this must land them on an empty,
 * focused line rather than doing nothing or appending to what is there.
 *
 * `projectId` and `surfaceId` are not consulted, for the reason measured earlier and still true: the
 * `surfaceId` the host sends is generated by the host (`sf-...`) and appears nowhere in a surface's own URL,
 * so a receiving surface cannot check it against itself. It does not need to here - the host opened this
 * window for this project, so an invocation arriving in it is for it.
 *
 * Escape is not handled here and must not be: the host dismisses the overlay from `before-input-event` on the
 * window, so that dismissal works even if this page is still loading. A second dismissal path in the page
 * would empty a window the host still has up.
 */
export function planCommandSurfaceInvoke(payload, { loadFailed = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.malformed };
  }
  if (payload.reason === 'hover-type-to-run') {
    if (typeof payload.initialText !== 'string' || [...payload.initialText].length !== 1
      || new TextEncoder().encode(payload.initialText).length > 8
      || !validCaptureId(payload.captureId)) {
      return { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.malformed };
    }
    return { kind: 'open-seeded', seed: payload.initialText };
  }
  if (payload.reason === 'hover-type-to-run-append') {
    if (typeof payload.appendText !== 'string' || [...payload.appendText].length !== 1
      || new TextEncoder().encode(payload.appendText).length > 8
      || !validCaptureId(payload.captureId)) {
      return { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.malformed };
    }
    return { kind: 'append-text', text: payload.appendText };
  }
  if (payload.reason !== COMMAND_SURFACE_INVOKE_REASON) {
    return { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.reason };
  }
  // Measured on the creator's machine: the launcher opened, took the keystroke, and had no items to search.
  // One of the ways that happens is the surface's boot load losing a race with the overlay window coming up,
  // and the cheapest honest answer is to ask again on the invocation - the same one source of items through
  // the same channel, with no cache and no second store. A load that landed is never repeated.
  return { kind: 'focus-and-clear', reload: loadFailed === true };
}
