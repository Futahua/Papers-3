/**
 * Pure runtime orchestration for window layouts.
 *
 * The controller owns ephemeral capabilities, switching generations,
 * observation and echo suppression. Persistence, host calls and rendering are
 * injected so this module cannot write workspace state or create UI by itself.
 */

/**
 * A member whose window this surface cannot confirm. Not "gone" - see the counting site: the host cannot
 * prove termination today, and the match it fails can fail on a changed title alone.
 */
export const WINDOW_LAYOUT_MEMBER_UNVERIFIED = 'unverified';
export const WINDOW_LAYOUT_UNVERIFIED_IDENTITY = 'identity-cannot-be-confirmed';

export const WINDOW_LAYOUT_RUNTIME_CADENCE_MS = 500;

/** 040: the shared composite ephemeral identity the pure runtime uses for its
 * capability cache. Every entry/widget capability/icon cache, DOM selector and
 * update/removal path keys by the SAME layout\u0000member composite so two
 * layouts referencing the same real window stay independent. */
export function windowLayoutMemberKey(layoutId, memberId) {
  return `${layoutId}\u0000${memberId}`;
}

/**
 * Return the legacy fallback key used when an exact native instance id is no
 * longer available.  This pair is only a hint: it is safe for fallback only
 * when it identifies one persisted member in the layout being resolved.
 */
export function windowLayoutLegacyDescriptorKey(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null;
  if (typeof descriptor.title !== 'string' || typeof descriptor.executableFingerprint !== 'string') return null;
  return `${descriptor.executableFingerprint}\u0000${descriptor.title}`;
}

export function windowLayoutLegacyDescriptorCount(layout, descriptor) {
  const key = windowLayoutLegacyDescriptorKey(descriptor);
  if (key === null) return 0;
  const members = Array.isArray(layout) ? layout : (layout?.arrangement?.members ?? []);
  return members.filter((member) =>
    windowLayoutLegacyDescriptorKey(member?.descriptor) === key).length;
}

/**
 * Resolve an exact persisted identity, then use the legacy pair only when it
 * identifies one persisted member in the caller's collection.  Keeping this
 * seam pure lets attached and compact-widget surfaces share the same guard.
 */
export async function resolveWindowLayoutDescriptorWithFallback({
  descriptor,
  members = null,
  exactIdentity = descriptor?.windowInstanceId,
  resolveExact,
  resolveFallback,
}) {
  const resolved = await resolveExact(exactIdentity ?? descriptor);
  // Stable native identities are exact: if the instance is gone or no longer
  // matches, never let a legacy title/fingerprint lookup bind a same-title
  // sibling. Fallback exists only for pre-identity persisted descriptors.
  if (typeof exactIdentity === 'string' || resolved?.outcome !== 'missing') {
    return resolved;
  }
  if (Array.isArray(members) && windowLayoutLegacyDescriptorCount(members, descriptor) > 1) {
    return {
      outcome: 'ambiguous',
      error: 'legacy fallback is ambiguous within this persisted layout',
      reason: 'duplicate persisted title and executable fingerprint',
    };
  }
  return resolveFallback({
    version: descriptor.version,
    title: descriptor.title,
    executableFingerprint: descriptor.executableFingerprint,
  });
}

function memberKey(layoutId, memberId) {
  return windowLayoutMemberKey(layoutId, memberId);
}

function sameBounds(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameState(expected, actual) {
  const expectedMinimized = expected === 'minimized';
  const actualMinimized = actual === 'minimized';
  return expectedMinimized === actualMinimized;
}

function outcomeFor(result, fallback = 'failed') {
  return result && typeof result.outcome === 'string' ? result.outcome : fallback;
}

function layoutMembers(layout) {
  return layout?.arrangement?.members ?? [];
}

export function createWindowLayoutRuntime({
  getLayout,
  host,
  persistActiveLayout,
  persistObservation = () => undefined,
  onMemberResult = () => undefined,
  onRetireMember = () => undefined,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  cadenceMs = WINDOW_LAYOUT_RUNTIME_CADENCE_MS,
}) {
  if (typeof getLayout !== 'function') throw new TypeError('getLayout is required');
  if (!host || typeof host.resolveWindowDescriptor !== 'function'
    || typeof host.observeWindowCapability !== 'function'
    || typeof host.applyWindowCapability !== 'function'
    || typeof host.minimizeWindowCapability !== 'function'
    || typeof host.restoreWindowCapability !== 'function') {
    throw new TypeError('complete window capability host is required');
  }
  if (typeof persistActiveLayout !== 'function') throw new TypeError('persistActiveLayout is required');

  let generation = 0;
  let activeLayoutId = null;
  let activeMembers = [];
  let timer = null;
  let observationPending = false;
  let switchTail = Promise.resolve();
  const capabilities = new Map();
  const suppressions = new Map();
  // 019B: per-member consecutive-missing tracker (in-memory only, never persisted, keyed by layout/member,
  // reset on ownership change). It used to retire a member after exactly two consecutive `missing`
  // observations; it now only counts, and the count is the honest state of a member that cannot be verified.
  // See the note at the counting site for the measurement that removed the removal. `retired` is kept, and
  // nothing populates it today: no host outcome is terminal evidence yet.
  const missingCounts = new Map();
  const retired = new Set();
  // 018X3: in-flight observation promises are tracked so stop() can drain them.
  const observationsInFlight = new Set();

  function isCurrent(layoutId, expectedGeneration) {
    return activeLayoutId === layoutId && generation === expectedGeneration;
  }

  function stopTimer() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    activeMembers = [];
    observationPending = false;
  }

  function clearRuntimeState() {
    stopTimer();
    capabilities.clear();
    suppressions.clear();
    missingCounts.clear();
    retired.clear();
  }

  function report(layoutId, memberId, result) {
    const typed = {
      layoutId,
      memberId,
      outcome: outcomeFor(result),
      ...(result?.error !== undefined ? { error: result.error } : {}),
      // Carried through on purpose, and this is the point of the shape: a member this surface cannot confirm
      // has to be able to SAY so, and to say which of the two it is - "I could not check" against an answer
      // that would justify more. Without these two fields every unhealthy member reached the card as the same
      // flat word, which is exactly how an unverifiable one looked identical to a dead one.
      ...(result?.reason !== undefined ? { reason: result.reason } : {}),
      ...(result?.consecutiveMissing !== undefined ? { consecutiveMissing: result.consecutiveMissing } : {}),
    };
    onMemberResult(typed);
    return typed;
  }

  async function applyMember(layoutId, member, expectedGeneration) {
    if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
    const resolved = await host.resolveWindowDescriptor(member.descriptor, layoutId);
    if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
    if (resolved.outcome !== 'success' || !resolved.capability) {
      return report(layoutId, member.id, resolved);
    }

    const capabilityKey = memberKey(layoutId, member.id);
    capabilities.set(capabilityKey, resolved.capability);
    suppressions.set(capabilityKey, {
      generation: expectedGeneration,
      bounds: member.bounds,
      state: member.state,
    });

    if (member.bounds) {
      const applied = await host.applyWindowCapability(resolved.capability, member.bounds);
      if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
      if (applied.outcome !== 'success') {
        suppressions.delete(capabilityKey);
        return report(layoutId, member.id, applied);
      }
    }

    const changed = member.state === 'minimized'
      ? await host.minimizeWindowCapability(resolved.capability)
      : await host.restoreWindowCapability(resolved.capability);
    if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
    if (changed.outcome !== 'success') {
      suppressions.delete(capabilityKey);
      return report(layoutId, member.id, changed);
    }
    return report(layoutId, member.id, { outcome: 'success' });
  }

  function startTimer(layoutId, expectedGeneration, memberIds) {
    activeMembers = [...memberIds];
    if (activeMembers.length === 0 || !isCurrent(layoutId, expectedGeneration)) return;
    timer = setIntervalFn(() => {
      const pending = observeActiveMembers(layoutId, expectedGeneration);
      observationsInFlight.add(pending);
      pending.finally(() => observationsInFlight.delete(pending)).catch(() => undefined);
    }, cadenceMs);
  }

  async function runSwitch(layoutId, expectedGeneration) {
    if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
    const target = layoutId === null ? null : getLayout(layoutId);
    if (layoutId !== null && (!target || target.bin)) {
      // A binned/removed layout is never activated: applying its saved
      // arrangement could move windows that no longer belong to a live layout.
      return { outcome: 'missing-layout', layoutId, results: [] };
    }
    stopTimer();
    suppressions.clear();
    missingCounts.clear();
    retired.clear();
    await persistActiveLayout(layoutId);
    if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
    activeLayoutId = layoutId;
    if (layoutId === null) {
      capabilities.clear();
      return { outcome: 'inactive', layoutId: null, results: [] };
    }

    const results = [];
    const successful = [];
    for (const member of layoutMembers(getLayout(layoutId))) {
      const result = await applyMember(layoutId, member, expectedGeneration);
      results.push(result);
      if (result.outcome === 'success') successful.push(member.id);
      if (generation !== expectedGeneration) {
        return { outcome: 'superseded', layoutId, results };
      }
    }
    // The selected id is retained even when every member is currently missing,
    // allowing a later retry/reconcile to recover without inventing a launch.
    startTimer(layoutId, expectedGeneration, successful);
    return {
      outcome: successful.length === results.length ? 'success' : 'partial',
      layoutId,
      results,
      recordingMemberIds: successful,
    };
  }

  function switchTo(layoutId) {
    const expectedGeneration = ++generation;
    stopTimer();
    const next = switchTail.then(() => runSwitch(layoutId, expectedGeneration));
    switchTail = next.catch(() => undefined);
    return next;
  }

  async function observeMember(layoutId, memberId, expectedGeneration) {
    if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded' };
    const key = memberKey(layoutId, memberId);
    if (retired.has(key)) return { layoutId, memberId, outcome: 'retired' };
    const capability = capabilities.get(key);
    if (capability) {
      const observed = await host.observeWindowCapability(capability);
      if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded' };
      if (observed.outcome === 'success' && observed.observation) {
        // A genuine success clears the member's missing streak.
        missingCounts.delete(key);
        const observation = observed.observation;
        const suppression = suppressions.get(key);
        if (suppression && suppression.generation === expectedGeneration) {
          suppressions.delete(key);
          if ((suppression.bounds === null || sameBounds(suppression.bounds, observation.bounds))
            && sameState(suppression.state, observation.state)) {
            return { layoutId, memberId, outcome: 'echo-suppressed' };
          }
        }
        const patch = {
          state: observation.state === 'minimized' ? 'minimized' : 'normal',
          // A minimized rectangle is not a restore rectangle. The injected model
          // callback therefore receives no bounds and must preserve the old one.
          ...(observation.state === 'minimized' ? {} : { bounds: observation.bounds ?? null }),
        };
        persistObservation(layoutId, memberId, patch);
        return { layoutId, memberId, outcome: 'recorded', patch };
      }
      if (observed.outcome !== 'missing') {
        // timeout/helper-unavailable/denied/malformed/ambiguous never remove
        // and never count as missing (the streak is preserved, not reset).
        return report(layoutId, memberId, observed);
      }
      // 'missing': the SESSION capability is stale (e.g. after a helper restart)
      // or the window really vanished. Invalidate it so a fresh resolution can
      // prove which; do NOT count this miss yet.
      capabilities.delete(key);
    }
    // 019HR: no usable capability (invalidated stale or absent) - re-resolve the
    // member's persisted descriptor BEFORE any miss can count. A freshly
    // re-resolved LIVE window recovers with its new capability (streak cleared,
    // never retires); only a fresh descriptor resolution that CONFIRMS the
    // window is missing may increment the genuine-missing streak (exactly two
    // confirmed misses retire once). A helper-unavailable/timeout/denied/
    // malformed re-resolution never increments and never removes (the streak is
    // preserved, not reset).
    const member = layoutMembers(getLayout(layoutId)).find((candidate) => candidate.id === memberId);
    let reResolved = null;
    if (member?.descriptor) {
      try {
        reResolved = await host.resolveWindowDescriptor(member.descriptor, layoutId);
      } catch {
        reResolved = null;
      }
      if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded' };
    }
    if (reResolved && reResolved.outcome === 'success' && reResolved.capability) {
      // Recovered: the window is live; replace the capability and clear the
      // streak safely. The next cadence observes the fresh capability.
      capabilities.set(key, reResolved.capability);
      missingCounts.delete(key);
      return { layoutId, memberId, outcome: 'recovered' };
    }
    if (!reResolved || reResolved.outcome !== 'missing') {
      // Cannot confirm a genuine miss (transient/rejected resolution or no
      // descriptor): preserve the streak, never remove, never count.
      return report(layoutId, memberId, reResolved ?? { outcome: 'missing-capability' });
    }
    // Exact tagged identities are terminal only when the helper completed a
    // successful enumeration and proved that this opaque instance id is absent.
    // Unlike the legacy title/fingerprint hint, a missing exact id cannot be a
    // Chrome tab-title change. Retire every occurrence through the injected
    // writer; transient helper failures never reach this branch.
    if (typeof member?.descriptor?.windowInstanceId === 'string') {
      retired.add(key);
      missingCounts.delete(key);
      onRetireMember({
        layoutId,
        memberId,
        descriptor: member.descriptor,
        reason: 'exact native window instance is gone',
      });
      return report(layoutId, memberId, { outcome: 'retired', reason: 'exact native window instance is gone' });
    }
    // Counted, never acted on. What the count means: this member's descriptor no longer matches a live
    // window, and the match that failed is `executableFingerprint + exact title` (host `resolvePersisted`),
    // so a window that is alive and well but retitled - a browser tab switch is the creator's own example -
    // produces `missing` exactly like a dead one. A title is not identity: that is the defect the identity
    // work fixed on the session-token path and left standing on this one, and the records are explicit that
    // GONE requires positive terminal evidence while absence, an enumeration miss, a refusal and a timeout
    // are all UNVERIFIED. So the streak stays in memory, the member stays in the layout, its capability is
    // still re-resolved on the next cadence (so it recovers on its own when the window is found again), and
    // nothing here removes anything. Measured end to end before this changed: with the capability lost (a
    // helper restart - capabilities are in memory and never persisted) and the title changed, two cycles
    // emitted `retire` for every member and the writer removed all three from the document and saved.
    const count = (missingCounts.get(key) ?? 0) + 1;
    missingCounts.set(key, count);
    return report(layoutId, memberId, {
      outcome: WINDOW_LAYOUT_MEMBER_UNVERIFIED,
      reason: WINDOW_LAYOUT_UNVERIFIED_IDENTITY,
      consecutiveMissing: count,
    });
  }

  async function observeActiveMembers(layoutId = activeLayoutId, expectedGeneration = generation) {
    if (observationPending || !isCurrent(layoutId, expectedGeneration)) return [];
    const layout = getLayout(layoutId);
    if (!layout || layout.bin) {
      // 017I2: the active layout was binned/deleted through the model (which
      // already cleared the persisted id). Stop the recording timer so no
      // stale observer survives; the persisted clearing is the model's job.
      clearRuntimeState();
      activeLayoutId = null;
      return [];
    }
    observationPending = true;
    try {
      const results = [];
      for (const memberId of [...activeMembers]) {
        results.push(await observeMember(layoutId, memberId, expectedGeneration));
        if (!isCurrent(layoutId, expectedGeneration)) break;
      }
      return results;
    } finally {
      observationPending = false;
    }
  }

  async function retry(layoutId = activeLayoutId) {
    return switchTo(layoutId);
  }

  /** Cold start: adopt the persisted layout as the OBSERVED context without
   * touching a single window.
   *
   * Resuming recording and activating a layout are different things. A
   * deliberate switch (L1 -> L2) places and restores members, which is what
   * switchTo() is for. Launching Papers must only resume observing whichever
   * layout was active: replaying it re-applied every member's saved geometry and
   * restored its window one after another for about eight seconds after launch,
   * raising the creator's own windows over whatever they were doing. */
  async function resumeActive(layoutId) {
    if (typeof layoutId !== 'string' || layoutId.length === 0) {
      return { outcome: 'inactive', layoutId: null, results: [] };
    }
    const layout = getLayout(layoutId);
    if (!layout || layout.bin) return { outcome: 'inactive', layoutId: null, results: [] };
    if (activeLayoutId === layoutId) return reconcileActive();
    ++generation;
    stopTimer();
    suppressions.clear();
    missingCounts.clear();
    retired.clear();
    activeLayoutId = layoutId;
    // No persistActiveLayout: the id came FROM the document, so writing it back
    // would be a document mutation caused by merely launching.
    return reconcileActive();
  }

  /** 017I2: re-sync the observed member set from the CURRENT persisted layout
   * WITHOUT re-applying saved geometry (a member was added or removed while the
   * layout stayed active). A binned/removed active layout delegates to
   * switchTo(null); with zero live capabilities the timer is left off but the
   * id is retained for a later retry. Never writes state itself. */
  async function reconcileActive() {
    const expectedGeneration = generation;
    const layoutId = activeLayoutId;
    if (layoutId === null) return { outcome: 'inactive', layoutId: null, results: [] };
    if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
    const layout = getLayout(layoutId);
    if (!layout || layout.bin) return switchTo(null);
    stopTimer();
    const successful = [];
    for (const member of layoutMembers(layout)) {
      const key = memberKey(layoutId, member.id);
      let capability = capabilities.get(key);
      if (!capability) {
        const resolved = await host.resolveWindowDescriptor(member.descriptor, layoutId);
        if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
        if (resolved.outcome === 'success' && resolved.capability) {
          capability = resolved.capability;
          capabilities.set(key, capability);
        }
      }
      if (capability) {
        // 019B/019HR2: a successfully re-resolved (reappeared) member is
        // observed again; its retired flag AND its prior missing streak are
        // cleared so a future genuine-missing streak starts fresh and can never
        // inherit an old count (miss1 -> proven-live reconcile -> miss1 must
        // NOT read as count2).
        retired.delete(key);
        missingCounts.delete(key);
        successful.push(member.id);
      }
    }
    if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded', layoutId, results: [] };
    startTimer(layoutId, expectedGeneration, successful);
    return {
      outcome: successful.length === 0 ? 'inactive' : 'success',
      layoutId,
      recordingMemberIds: successful,
    };
  }

  function invalidateCapabilities(layoutId = null) {
    for (const key of [...capabilities.keys()]) {
      if (layoutId === null || key.startsWith(`${layoutId}\u0000`)) capabilities.delete(key);
    }
  }

  /** 018X3: stop is a REAL drain barrier, not only generation invalidation.
   * It awaits the captured switch chain and every in-flight observation so any
   * host apply/minimize/restore/observe already issued by the workspace settles
   * before the caller (the detach handoff) flushes and ACKs. */
  async function stop({ clearActive = true } = {}) {
    const drainTail = switchTail;
    const drainObservations = [...observationsInFlight];
    ++generation;
    clearRuntimeState();
    activeLayoutId = null;
    await drainTail.catch(() => undefined);
    await Promise.all(drainObservations.map((promise) => promise.catch(() => undefined)));
    if (clearActive) await persistActiveLayout(null);
  }

  return {
    switchTo,
    retry,
    reconcileActive,
    resumeActive,
    observeActiveMembers,
    invalidateCapabilities,
    stop,
    getSnapshot: () => ({
      activeLayoutId,
      generation,
      recordingMemberIds: [...activeMembers],
      timerActive: timer !== null,
      capabilityKeys: [...capabilities.keys()],
      suppressionKeys: [...suppressions.keys()],
    }),
  };
}

/**
 * 017I2 wiring (RoketPuncha integration lane): the model/store glue the
 * workspace entry uses to own recording with the pure controller. Kept in this
 * module so the integration test exercises the SAME wiring the entry runs
 * against the real model - byte-stable inactive arrangements, minimized
 * restore bounds preserved, prompt saves and typed status - instead of a
 * re-implementation.
 *
 * `model` must expose `setActiveWindowLayoutId(state, idOrNull)` and
 * `updateWindowLayoutMember(state, layoutId, memberId, patch)`. `replaceState`
 * is called only when the model returned a NEW state reference; `scheduleSave`
 * queues a prompt persistence. `statusText(outcome)` maps typed member
 * outcomes to a status string.
 */
export function createWindowLayoutRecordingWiring({
  getLayout,
  host,
  model,
  getState,
  replaceState,
  scheduleSave,
  setStatus,
  patchMember,
  onObservationStateChange = () => undefined,
  statusText,
  onMemberOutcome,
  onRetireMember,
  setIntervalFn,
  clearIntervalFn,
  cadenceMs,
}) {
  const runtime = createWindowLayoutRuntime({
    getLayout,
    host,
    persistActiveLayout: (idOrNull) => {
      const current = getState();
      const next = model.setActiveWindowLayoutId(current, idOrNull);
      if (next !== current) replaceState(next);
      scheduleSave();
    },
    persistObservation: (layoutId, memberId, patch) => {
      const current = getState();
      const previousMember = layoutMembers(getLayout(layoutId)).find((candidate) => candidate.id === memberId);
      const stateChanged = previousMember?.state !== patch.state;
      const next = model.updateWindowLayoutMember(current, layoutId, memberId, patch);
      if (next !== current) {
        replaceState(next);
        const member = layoutMembers(getLayout(layoutId)).find((candidate) => candidate.id === memberId);
        patchMember?.(layoutId, memberId, member?.state ?? 'normal');
        if (stateChanged) onObservationStateChange(layoutId, memberId, member?.state ?? 'normal');
      }
      scheduleSave();
    },
    onMemberResult: (result) => {
      // The card's own state listens to every result, before the status mapping decides what to say: a member
      // this surface cannot confirm has to be visible ON THE MEMBER, not only in a layout-wide status line.
      onMemberOutcome?.(result);
      if (result.outcome !== 'success' && result.outcome !== 'recorded'
        && result.outcome !== 'echo-suppressed' && result.outcome !== 'superseded') {
        setStatus?.(result.layoutId, statusText?.(result.outcome) ?? 'Failed');
      }
    },
    onRetireMember,
    setIntervalFn,
    clearIntervalFn,
    cadenceMs,
  });

  /** Align the recording context to a desired persisted active id: switch the
   * whole layout when the context changes, otherwise re-sync the observed
   * members without re-applying saved geometry. */
  async function ensureRecording(targetLayoutId) {
    if (targetLayoutId === null) return runtime.switchTo(null);
    if (runtime.getSnapshot().activeLayoutId === targetLayoutId) return runtime.reconcileActive();
    return runtime.switchTo(targetLayoutId);
  }

  /** Cold start only: adopt the persisted layout as the observed context. No
   * window is placed, restored or raised by resuming. */
  async function resumeRecording(targetLayoutId) {
    if (typeof targetLayoutId !== 'string' || targetLayoutId.length === 0) return { outcome: 'inactive', layoutId: null, results: [] };
    return runtime.resumeActive(targetLayoutId);
  }

  return { runtime, ensureRecording, resumeRecording };
}
