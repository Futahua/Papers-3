/**
 * 018A1 As You Go half of the frozen exclusive-controller-handoff sequence
 * (BRAIN 018H2/H3 protocol). Exactly one controller/observer/save owner exists
 * at any time: while a layout controller is detached, the original workspace
 * is READ-ONLY except Focus/Reattach/close, and the detached surface does not
 * load durable state or start a controller until main has received the
 * workspace stop+flush ACK and sends ACTIVATE.
 *
 * Lifecycle traffic is bridged through enumerated `papers:project:detach-*`
 * window messages in the existing project preload (Papers-side); the opaque
 * transferId never enters page data. This module owns the As You Go side of the
 * transfer: read-only handoff, awaited store flush before ACK, activate-only
 * load, symmetric detached flush, crash/closed reload-resume and idempotent
 * teardown. All dependencies are injected so the integration test drives the
 * same production wiring the entry runs.
 *
 * The factory never loads durable state itself. Workspace resume (CLOSED /
 * crash / open-failed) is delegated to the injected `loadWorkspace` /
 * `installState` / `render` / `startController`; detached activation resolves
 * `waitForActivate()` so the entry's bootstrap (the real load path) proceeds
 * only after ACTIVATE.
 */

export const DETACH_MESSAGE = {
  STOP_REQUEST: 'papers:project:detach-stop-request',
  ACTIVATE: 'papers:project:detach-activate',
  FLUSH_REQUEST: 'papers:project:detach-flush-request',
  CLOSED: 'papers:project:detach-closed',
};

/** Sentinel resolved by `waitForActivate()` when the surface stops before
 * ACTIVATE (018X2). The entry treats it as an explicit cancellation: it must
 * NOT load durable state or start the controller. */
export const DETACH_ACTIVATE_CANCELLED = Symbol('detach-activate-cancelled');

/**
 * 018X7 read-only status sink: wraps a UI status function so a delayed
 * persistence/status callback that settles AFTER a detach handoff became
 * read-only is suppressed (an old owner must not paint over the handoff).
 * Writable callers still see normal status. Node-testable with fake
 * isReadOnly/show; the entry wires it as the store's setStatus seam.
 */
export function createReadOnlyStatusSink({ isReadOnly, show }) {
  if (typeof isReadOnly !== 'function' || typeof show !== 'function') {
    throw new TypeError('read-only status sink wiring is required');
  }
  return (text, options) => {
    if (isReadOnly()) return;
    show(text, options);
  };
}

/**
 * 018V7R: the real host bridge returns SERIALIZED JSON state (a string) for
 * project load; `bootstrapWorkspace` parses a string before install, but the
 * detach resume passes `loadWorkspace()` straight into `installState`, so a
 * string would normalize to the empty fallback. The production resume adapter
 * decodes a host-shaped string here before store.install/restore/render.
 * Object-shaped injected/test values pass through unchanged; malformed JSON
 * throws so the existing resume queue recovery semantics apply (the queue
 * catches per-item failures and keeps read-only engaged).
 */
export function decodeResumeState(raw) {
  if (typeof raw !== 'string') return raw;
  return JSON.parse(raw);
}

/**
 * 018V7R3: the bounded window-layout presentation mode that controls the body
 * markup: 'readonly' (inert summary, no controls), 'detached' (Reattach), or
 * 'workspace' (Detach). ONE shared value so the body markup and the node content
 * signatures (create + refresh) cannot disagree. Pure/testable; the entry wires
 * `isReadOnly`/`mode` from the detachment factory.
 */
export function windowLayoutPresentationMode({ isReadOnly, mode }) {
  if (isReadOnly) return 'readonly';
  return mode === 'detached' ? 'detached' : 'workspace';
}

/**
 * 018V7R3: the window-layout content-signature fragment - presentation mode +
 * persisted arrangement (version + member ids/states) - shared by the create
 * and refresh signatures so the cached inert read-only HTML is never reused for
 * the writable view. Non-window-layout kinds keep their existing signatures.
 */
export function windowLayoutContentSignature(candidate, mode) {
  return mode
    + '|' + (candidate.arrangement?.version ?? 0)
    + '|' + (candidate.arrangement?.members ?? []).map((m) => `${m.id}:${m.state}`).join(',');
}

/**
 * 018X4 member-drag guard (the 016 inner member reorder/unlink drag). The
 * workspace's DOM drag handlers share this state machine so the read-only
 * handoff can cancel it and a later pointerup / reused pointer ID cannot
 * finalize an unlink/reorder after reattach. `finalize` runs the callback ONLY
 * for a live drag whose pointerId matches, then clears the drag exactly once.
 */
export function createWindowLayoutMemberDrag({ thresholdPx = 8, dropOutPx = 40 } = {}) {
  let drag = null;
  return {
    start({ layoutId, memberId, clientX, clientY, pointerId }) {
      drag = { layoutId, memberId, startX: clientX, startY: clientY, moved: false, pointerId };
      return drag;
    },
    move(pointerId, clientX, clientY) {
      const current = drag;
      if (!current || current.pointerId !== pointerId) return null;
      if (!current.moved && Math.hypot(clientX - current.startX, clientY - current.startY) < thresholdPx) {
        return null;
      }
      current.moved = true;
      return current;
    },
    /** Finalizes ONLY a live, pointer-matching drag (returns true and calls
     * onLive once); a cancelled drag or a reused/different pointer is a no-op. */
    finalize(pointerId, onLive) {
      if (!drag || drag.pointerId !== pointerId) return false;
      const entry = drag;
      drag = null;
      if (onLive) onLive(entry);
      return true;
    },
    cancel() {
      drag = null;
    },
    /** 018X6: cancel ONLY when the pointer matches the active drag (ordinary
     * pointercancel / multi-pointer behavior); read-only/Escape use the
     * unconditional cancel(). Returns whether the drag was cleared. */
    cancelMatching(pointerId) {
      if (!drag || drag.pointerId !== pointerId) return false;
      drag = null;
      return true;
    },
    isActive() {
      return drag !== null;
    },
    get() {
      return drag;
    },
  };
}

/**
 * 018X6: reorders member buttons back to the canonical persisted arrangement
 * order (used by read-only drag cancellation to roll back a pointermove that
 * already reordered the live DOM). Pure and node-testable: it never mutates
 * state/commit/save and never finalizes. Unknown buttons are preserved at the
 * end so no DOM node is ever dropped.
 */
export function orderWindowLayoutMemberButtons(buttons, memberIds) {
  const byId = new Map();
  for (const button of buttons) {
    const id = button?.dataset?.wlMember ?? button?.memberId;
    if (id !== undefined && id !== null && !byId.has(id)) byId.set(id, button);
  }
  const ordered = [];
  const placed = new Set();
  for (const id of memberIds) {
    const button = byId.get(id);
    if (button && !placed.has(button)) {
      ordered.push(button);
      placed.add(button);
    }
  }
  for (const button of buttons) {
    if (!placed.has(button)) {
      ordered.push(button);
      placed.add(button);
    }
  }
  return ordered;
}

/**
 * 018X5 group-action runner: the systematic await/read-only barrier for the
 * 016/017 group member actions. After EVERY awaited host call the next
 * executable boundary aborts on read-only, so a handoff begun mid-operation
 * never issues another host call, never decides/calls restore after an apply
 * crossed into read-only, and never continues to a later member. The entry
 * drives its DOM/state patches; the host-call orchestration and the barriers
 * live here so node tests exercise the same production code.
 */
export function createWindowLayoutGroupActionRunner({ isReadOnly, host }) {
  if (typeof isReadOnly !== 'function'
    || !host || typeof host.observeWindowCapability !== 'function'
    || typeof host.applyWindowCapability !== 'function'
    || typeof host.minimizeWindowCapability !== 'function'
    || typeof host.restoreWindowCapability !== 'function') {
    throw new TypeError('complete group-action runner wiring is required');
  }
  function aborted() {
    return isReadOnly() ? 'superseded' : null;
  }
  async function runMember(capability, member, action) {
    const gate = aborted();
    if (gate) return gate;
    const observed = await host.observeWindowCapability(capability);
    if (aborted()) return 'superseded';
    if (observed.outcome !== 'success' || !observed.observation) return observed.outcome;
    let result = null;
    if (action === 'minimize') {
      result = await host.minimizeWindowCapability(capability);
      if (aborted()) return 'superseded';
    } else {
      if (member.bounds) {
        result = await host.applyWindowCapability(capability, member.bounds);
        // A handoff begun during apply aborts BEFORE restore is ever decided or
        // called (the next executable boundary is the abort).
        if (aborted()) return 'superseded';
      }
      if (!result || result.outcome === 'success') {
        result = await host.restoreWindowCapability(capability);
      }
      if (aborted()) return 'superseded';
    }
    return result.outcome;
  }
  return { runMember, aborted };
}

/** Per-member icon toggle. Unlike the helper's low-latency toggle command,
 * restoring follows the same saved-bounds + restore path used by the working
 * Restore all control, so the exact window is shown in front at its remembered
 * location. The caller serializes repeated clicks for one member. */
export async function toggleWindowLayoutMemberVisibility({
  host,
  capability,
  member,
  isReadOnly,
  resolveCapability = null,
  isMemberCurrent = () => true,
}) {
  const aborted = () => isReadOnly() ? 'superseded' : null;
  const stillCurrent = () => isMemberCurrent() === true;
  if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
  let activeCapability = capability;
  let observed = null;
  let observationFailed = false;
  // ONE transaction decides and acts. The helper reads the live state and toggles
  // inside a single request, returning the pre-mutation observation and the action
  // it took. The old path observed here, carried the answer back across IPC,
  // decided in the page and returned to mutate - two or three full round trips for
  // one click - and Papers' observe also started a thumbnail capture on the
  // click's own lane.
  if (typeof host.toggleWindowCapability === 'function' && activeCapability) {
    let toggled = null;
    try {
      toggled = await host.toggleWindowCapability(activeCapability);
    } catch {
      // The request may have reached the native helper before its response was
      // lost. Never replay a visibility mutation with an unknown outcome.
      return { outcome: 'uncertain' };
    }
    if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
    if (toggled?.outcome !== 'success') return toggled ?? { outcome: 'failed' };
    const tookAction = toggled.action === 'restore' ? 'restore' : 'minimize';
    // Restoring is the only case that still needs a second request: the window is
    // put back at its remembered rectangle. Minimizing is complete.
    if (tookAction === 'restore' && member.bounds) {
      let applied = null;
      try {
        applied = await host.applyWindowCapability(activeCapability, member.bounds);
      } catch {
        return { outcome: 'uncertain', action: tookAction };
      }
      if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
      if (applied?.outcome !== 'success') return applied ?? { outcome: 'failed' };
    }
    return {
      ...toggled,
      action: tookAction,
      observation: toggled.observation ?? null,
    };
  }
  for (let attempt = 0; attempt < (typeof resolveCapability === 'function' ? 2 : 1); attempt += 1) {
    if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
    if (attempt > 0 || !activeCapability) {
      try {
        const resolved = await resolveCapability();
        if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
        if (resolved?.outcome !== 'success' || !resolved.capability) {
          if (attempt === 0) continue;
          return resolved ?? { outcome: 'failed' };
        }
        activeCapability = resolved.capability;
      } catch {
        if (attempt === 0) continue;
        return { outcome: 'failed' };
      }
    }
    try {
      observed = await host.observeWindowCapability(activeCapability);
    } catch {
      observationFailed = true;
      observed = null;
    }
    if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
    if (observed?.outcome === 'success' && observed.observation) break;
    observationFailed = true;
    if (attempt > 0 || typeof resolveCapability !== 'function') return observed ?? { outcome: 'failed' };
    activeCapability = null;
  }
  if (!observed?.observation || observed.outcome !== 'success') {
    return observed ?? { outcome: observationFailed ? 'failed' : 'missing' };
  }
  const action = observed.observation.state === 'minimized' ? 'restore' : 'minimize';
  let result;
  try {
    if (action === 'restore') {
      if (member.bounds) {
        result = await host.applyWindowCapability(activeCapability, member.bounds);
        if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
        if (result.outcome !== 'success') return result;
      }
      result = await host.restoreWindowCapability(activeCapability);
    } else {
      result = await host.minimizeWindowCapability(activeCapability);
    }
  } catch {
    // The request may have reached the native helper before its response was
    // lost. Never replay a visibility mutation with an unknown outcome.
    return { outcome: 'uncertain', action };
  }
  if (aborted() || !stillCurrent()) return { outcome: 'superseded' };
  return result.outcome === 'success'
    ? { ...result, observation: observed.observation, action }
    : result;
}

/**
 * 018X3 read-only input guards. While a layout controller is detached the
 * workspace is read-only: capture-phase key/beforeinput/pointer events are
 * swallowed so workspace hotkeys and a still-captured gesture cannot finalize.
 * The ONLY allowed surface is the Focus/Reattach toolbar: pointer events whose
 * target is inside it pass through (a captured old gesture targets the
 * underlying canvas and stays blocked), and Enter/Space on a focused toolbar
 * button explicitly activates that button exactly once while preventing
 * default and blocking propagation to workspace hotkeys. Ctrl+Z/other keys on
 * a focused toolbar button remain blocked. The logic is isolated so the entry
 * wires it and node tests drive the real behavior with fake events.
 */
export function createDetachReadOnlyInputGuards({
  windowRef,
  getToolbar,
  isActivationKey = (key) => key === 'Enter' || key === ' ' || key === 'Spacebar',
}) {
  if (!windowRef || typeof windowRef.addEventListener !== 'function') {
    throw new TypeError('a window with addEventListener is required');
  }
  if (typeof getToolbar !== 'function') throw new TypeError('getToolbar is required');
  const state = { armed: false, keyCapture: null, pointerCapture: null };

  function inToolbar(target) {
    const toolbar = getToolbar();
    return Boolean(toolbar && target && toolbar.contains(target));
  }

  function onKeyCapture(event) {
    if (inToolbar(event.target)) {
      if (isActivationKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.target && typeof event.target.click === 'function') {
          event.target.click();
        }
        return;
      }
      // Ctrl+Z / other keys on a focused toolbar button: blocked below.
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerCapture(event) {
    if (inToolbar(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function arm() {
    if (state.armed) return;
    state.keyCapture = onKeyCapture;
    state.pointerCapture = onPointerCapture;
    windowRef.addEventListener('keydown', state.keyCapture, true);
    windowRef.addEventListener('beforeinput', state.keyCapture, true);
    windowRef.addEventListener('pointerup', state.pointerCapture, true);
    windowRef.addEventListener('pointercancel', state.pointerCapture, true);
    windowRef.addEventListener('pointermove', state.pointerCapture, true);
    windowRef.addEventListener('click', state.pointerCapture, true);
    state.armed = true;
  }

  function disarm() {
    if (!state.armed) return;
    windowRef.removeEventListener('keydown', state.keyCapture, true);
    windowRef.removeEventListener('beforeinput', state.keyCapture, true);
    windowRef.removeEventListener('pointerup', state.pointerCapture, true);
    windowRef.removeEventListener('pointercancel', state.pointerCapture, true);
    windowRef.removeEventListener('pointermove', state.pointerCapture, true);
    windowRef.removeEventListener('click', state.pointerCapture, true);
    state.keyCapture = null;
    state.pointerCapture = null;
    state.armed = false;
  }

  return { arm, disarm, isArmed: () => state.armed };
}

/** The CLOSED push carries a flat `reason` for crash/open-failed status; the
 * separate CRASH/OPEN_FAILED pushes are dead and are not handled. */
export function detachReasonStatus(reason) {
  if (reason === 'crash') return 'Detached surface recovered';
  if (typeof reason === 'string' && reason) return reason;
  return null;
}

/** True when this page runs as the Papers-owned detached surface
 * (`?detach=1` on the validated project entry). */
export function isDetachedWindow(locationLike) {
  const query = typeof locationLike === 'string' ? locationLike : String(locationLike?.search ?? '');
  return /[?&]detach=1($|&)/.test(query);
}

/**
 * Read-only save gate for the exclusive handoff (018X1/018X3/018X8). While
 * read-only EVERY public mutator (commit/replace/undo/redo via the entry) is a
 * no-op for the ENTIRE read-only interval. Persistence is authorized by an
 * EXACT, unforgeable per-flush permit (018X8): `flush()` mints a unique token
 * and passes it ONLY to its raw `saveState`; the production persist callback
 * allows a read-only write only when the metadata token equals the gate's
 * currently valid token, so an OLD queued commit save (which carries no token)
 * resolves as suppressed instead of being persisted during the flush window.
 * The permit is consumed/invalidated in finally, including on rejection.
 */
export function createDetachSaveGate({ getState, replaceState, commitState, saveState }) {
  if (typeof getState !== 'function' || typeof replaceState !== 'function'
    || typeof commitState !== 'function' || typeof saveState !== 'function') {
    throw new TypeError('complete save-gate wiring is required');
  }
  let readOnly = false;
  let flushToken = null;

  function replace(next) {
    if (readOnly) return getState();
    return replaceState(next);
  }

  function commit(next, options) {
    if (readOnly) return Promise.resolve(false);
    return commitState(next, options);
  }

  /** Whether a persistence attempt is authorized. Writable saves always pass;
   * read-only saves pass ONLY for the gate's currently valid flush token. */
  function permitsPersist(metadata) {
    if (!readOnly) return true;
    return flushToken !== null && metadata === flushToken;
  }

  /** The one allowed write during a handoff: capture the current view into
   * state via the RAW internal replace, then await the REAL store save queue
   * carrying the unique permit token. Returns the captured state. */
  async function flush(capture) {
    const token = Symbol('detach-flush-permit');
    flushToken = token;
    try {
      const next = replaceState(capture());
      await saveState(getState(), token);
      return next;
    } finally {
      if (flushToken === token) flushToken = null;
    }
  }

  return {
    replace,
    commit,
    flush,
    permitsPersist,
    setReadOnly: (flag) => { readOnly = flag; },
    isReadOnly: () => readOnly,
    isFlushing: () => flushToken !== null,
  };
}

export function createWindowLayoutDetachment({
  isDetached = false,
  host,
  loadWorkspace,
  installState,
  render,
  startController,
  stopController,
  cancelPick,
  flushSave,
  setReadOnly,
  setStatus,
}) {
  if (!host || typeof host.onDetachMessage !== 'function') {
    throw new TypeError('a host bridge with onDetachMessage is required');
  }
  if (typeof stopController !== 'function' || typeof flushSave !== 'function'
    || typeof setReadOnly !== 'function') {
    throw new TypeError('complete detach wiring is required');
  }

  const state = {
    mode: isDetached ? 'detached' : 'workspace',
    transferId: null,
    readOnly: false,
    detachedActive: false,
    busy: false,
    stopped: false,
  };
  let readyReported = false;
  const activateWaiters = [];
  const idleWaiters = [];
  let openInFlight = false;
  let transferBegunWhileOpen = false;

  // Lifecycle pushes are serialized through one queue: a CLOSED/crash arriving
  // while STOP_REQUEST is in flight is QUEUED and processed after, never
  // dropped. A different transferId is ignored while another owns the session.
  // 018X2: dedupe tracks queued + in-flight (kind, transferId) keys too, so two
  // identical pushes (one queued, one in flight) execute once; the key is
  // released on failure (a retry can still run) and retained on success.
  const queue = [];
  const pendingKeys = new Set();
  const completed = [];
  const MAX_COMPLETED = 64;
  let draining = false;
  /** 018V4 receipt-confirmed ACTIVATE: best-effort ACK for a valid ACTIVATE of
   * the ACTIVE transfer. The initial ACK failure is retried only when the next
   * ACTIVATE resend arrives (no page timer). Never ACKs a foreign transfer. */
  function sendActivatedReceipt(transferId) {
    if (typeof transferId !== 'string' || !transferId || transferId !== state.transferId) {
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(() => host.detachActivatedAck(transferId))
      .catch(() => undefined);
  }

  function enqueue(kind, transferId, fn) {
    if (state.stopped) return Promise.resolve();
    const key = typeof transferId === 'string' && transferId ? `${kind}:${transferId}` : null;
    if (key && (completed.includes(key) || pendingKeys.has(key))) {
      // 018V4: a duplicate ACTIVATE resend still ACKs (receipt for the active
      // transfer) even when deduped, but NEVER re-runs load/install/controller
      // start (that stays exactly once). A foreign transfer never ACKs.
      if (kind === 'activate') return sendActivatedReceipt(transferId);
      return Promise.resolve();
    }
    // Only one transfer owns the session at a time; ownership is RESERVED
    // atomically at the FIRST enqueue (not inside the handler), so simultaneous
    // STOP t1 + STOP t2 (both queued while state.transferId is still null)
    // execute only the first transfer; same-transfer later phases still run.
    if (state.transferId !== null && transferId !== state.transferId) return Promise.resolve();
    if (state.transferId === null && typeof transferId === 'string' && transferId) {
      state.transferId = transferId;
    }
    if (key) pendingKeys.add(key);
    return new Promise((resolve) => {
      queue.push({ kind, transferId, fn, resolve, key });
      void drain();
    });
  }
  async function drain() {
    if (draining || state.stopped) return;
    draining = true;
    try {
      while (queue.length > 0 && !state.stopped) {
        const item = queue.shift();
        state.busy = true;
        try {
          await item.fn();
          if (item.key) {
            pendingKeys.delete(item.key);
            completed.push(item.key);
            if (completed.length > MAX_COMPLETED) completed.splice(0, completed.length - MAX_COMPLETED);
          }
        } catch {
          // A per-item failure must never stop the queue; the key is released
          // so a retry of the same transfer can still be processed.
          if (item.key) pendingKeys.delete(item.key);
        } finally {
          state.busy = false;
          item.resolve();
        }
      }
    } finally {
      draining = false;
      if (queue.length === 0 && !state.busy) {
        for (const resolve of idleWaiters.splice(0)) resolve();
      }
    }
  }

  /** Resolves once the lifecycle queue is drained (no queued/in-flight push).
   * Used by detach-open failure to converge with a queued canonical CLOSED. */
  function whenIdle() {
    if (queue.length === 0 && !draining && !state.busy) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function resolveActivate(transferId) {
    state.transferId = transferId;
    state.detachedActive = true;
    for (const resolve of activateWaiters.splice(0)) resolve(transferId);
  }

  async function enterReadOnly() {
    state.readOnly = true;
    // 018X2 item 9: the read-only entry (pointer/marquee/layout gesture
    // cancellation + capture guards) is AWAITED so no mid-gesture pointerup can
    // finalize after the handoff begins and before the ACK.
    if (setReadOnly) await setReadOnly(true);
    // 018X1R/018X2: the direct-pick cancel must be AWAITED before the
    // controller stop/flush/ACK so a late pick result cannot overtake the
    // handoff.
    if (cancelPick) await cancelPick();
    // After awaited host work, re-check the handoff is still owned: an already
    // in-flight result must never mutate post-handoff state.
    if (!state.readOnly) return false;
    return true;
  }

  /** Best-effort ack: the preload answers immediately when it has a live
   * sender; if it cannot, the request times out rather than hanging the queue. */
  function ack(ackFn) {
    return Promise.resolve().then(ackFn).catch(() => undefined);
  }

  /** Workspace handoff: read-only, cancel pick (awaited), stop the controller
   * (persisted active id retained), cancel the debounce and flush the REAL
   * store save queue, THEN ack. No write may occur between the flush and the
   * ACK; the flush override covers both the capture replace and the awaited
   * store save. */
  async function handleStopRequest(transferId) {
    state.transferId = transferId;
    if (openInFlight) transferBegunWhileOpen = true;
    const owned = await enterReadOnly();
    if (!owned) return;
    await stopController();
    await flushSave();
    await ack(() => host.detachStopAck(transferId));
  }

  /** Workspace resume after CLOSED/crash/open-failed: reload durable state
   * BEFORE resuming the controller, then ack. The flat CLOSED `reason` drives
   * crash/open-failed status. 018X2: pointer/keyboard/save gates stay ENGAGED
   * through load/install/render AND the awaited controller start; ownership is
   * restored (read-only cleared) only once the controller has started.
   * 018V7R2: after the awaited controller start and the unlock, perform exactly
   * one POST-UNLOCK WRITABLE render BEFORE the RESUMED ACK - the required mode
   * transition from the inert read-only summary to the writable Detach
   * controls. The pre-start render is preserved so state is visible while
   * ownership starts. */
  async function handleWorkspaceResume(transferId, { reason } = {}) {
    const status = detachReasonStatus(reason);
    if (status) setStatus?.(status);
    const raw = await loadWorkspace();
    installState(raw);
    render();
    await startController();
    state.readOnly = false;
    setReadOnly(false);
    render();
    await ack(() => host.detachResumedAck(transferId));
    state.transferId = null;
  }

  /** Detached: ACTIVATE resolves the deferred that gates the entry's real
   * bootstrap load, and (018V4) sends the activated receipt AFTER the lifecycle
   * queue has accepted/processed it. READY is the preload token arrival after
   * loadURL; durable state is never read before this point. */
  async function handleActivate(transferId) {
    resolveActivate(transferId);
    await sendActivatedReceipt(transferId);
  }

  /** Detached flush (reattach/close): symmetric stop + awaited store flush
   * before the ACK. */
  async function handleFlushRequest(transferId) {
    await stopController();
    await flushSave();
    await ack(() => host.detachFlushAck(transferId));
    state.detachedActive = false;
    state.transferId = null;
  }

  const unsubscribe = host.onDetachMessage((type, detail = {}) => {
    if (type === DETACH_MESSAGE.STOP_REQUEST) return enqueue('stop', detail.transferId, () => handleStopRequest(detail.transferId));
    if (type === DETACH_MESSAGE.CLOSED) return enqueue('closed', detail.transferId, () => handleWorkspaceResume(detail.transferId, { reason: detail.reason }));
    if (type === DETACH_MESSAGE.ACTIVATE) return enqueue('activate', detail.transferId, () => handleActivate(detail.transferId));
    if (type === DETACH_MESSAGE.FLUSH_REQUEST) return enqueue('flush', detail.transferId, () => handleFlushRequest(detail.transferId));
    return Promise.resolve();
  });

  /** Detached boot: the preload token arrival after `loadURL` is the READY
   * signal's other half (018V2 two-sided latch). A fresh DETACHED page reports
   * renderer lifecycle-ready EXACTLY ONCE, only AFTER its detach-message
   * listener/factory is installed, and BEFORE waiting for ACTIVATE. The page
   * carries no token/transfer; the preload latches page-ready + token. */
  function reportReady() {
    if (readyReported) return Promise.resolve();
    readyReported = true;
    return host.detachReady();
  }

  /** Detached boot gate: resolves only when main sends ACTIVATE (after the
   * workspace stop+flush ACK). The entry's bootstrap loadState awaits this. */
  function waitForActivate() {
    if (state.stopped) return Promise.resolve(DETACH_ACTIVATE_CANCELLED);
    if (state.detachedActive) return Promise.resolve(state.transferId);
    return new Promise((resolve) => activateWaiters.push(resolve));
  }

  /** Workspace-initiated detach: resolves only after the detached surface has
   * been activated. Once Papers has begun a transfer, main's canonical CLOSED
   * is the SOLE recovery trigger: on activation timeout Papers sends CLOSED
   * and rejects this request, so the catch converges with the queued CLOSED
   * (awaiting the queue) instead of racing it with a second stop/start. Local
   * recovery is used only for failure BEFORE any transfer ownership exists. */
  async function detachOpen() {
    openInFlight = true;
    transferBegunWhileOpen = false;
    try {
      return await host.detachOpen();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!transferBegunWhileOpen) {
        // Pre-transfer failure: restore the workspace safely.
        await enterReadOnly();
        await stopController();
        state.readOnly = false;
        setReadOnly(false);
        await startController();
        state.transferId = null;
        setStatus?.(message);
      } else {
        // A transfer owns recovery: converge with the canonical CLOSED (one
        // reload/start/resumed ACK), never a second local stop/start.
        await whenIdle();
        setStatus?.(message);
      }
      throw error;
    } finally {
      openInFlight = false;
    }
  }

  function reattach() {
    return host.detachReattach();
  }

  /** Workspace Focus affordance while read-only: bring the detached surface
   * forward without reattaching. */
  function focusDetached() {
    return host.detachFocus();
  }

  /** Idempotent teardown: stop processing lifecycle pushes and detach the
   * listener. Pending pre-ACTIVATE waiters are resolved with the explicit
   * cancellation sentinel so the entry never loads or starts on pagehide. */
  function stop() {
    state.stopped = true;
    unsubscribe();
    for (const resolve of activateWaiters.splice(0)) resolve(DETACH_ACTIVATE_CANCELLED);
  }

  return {
    detachOpen,
    reattach,
    focusDetached,
    reportReady,
    waitForActivate,
    stop,
    isReadOnly: () => state.readOnly,
    isDetachedActive: () => state.detachedActive,
    isStopped: () => state.stopped,
    getState: () => ({ ...state }),
    unsubscribe,
  };
}
