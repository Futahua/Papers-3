import { addWindowLayoutMember } from '../workspace-model-20260730b.js';

/** Add one host-confirmed window lifecycle event to the durable Auto owner.
 * Host events are hints: exact instance resolution and a live observation must
 * both succeed, then owner/duplicate/suppression state is checked again after
 * the asynchronous calls before a commit is attempted. */
export function createWindowLayoutAutoTracking({
  getState,
  resolveWindowInstance,
  resolveWindowDescriptor,
  observeWindowCapability,
  commit,
  createMemberId = () => crypto.randomUUID(),
  onCommitted = () => {},
  onDiagnostic = () => {},
}) {
  if (typeof getState !== 'function'
    || typeof resolveWindowInstance !== 'function'
    || typeof observeWindowCapability !== 'function'
    || typeof commit !== 'function') {
    throw new TypeError('Auto tracking requires state, resolver, observer and durable commit adapters');
  }

  // The first complete lifecycle snapshot after this surface starts is only
  // a seed. It describes windows that may have existed before Auto was enabled.
  // Later complete snapshots can safely recover opens missed during a watcher
  // restart or subscription gap by diffing against the last accepted snapshot.
  let baselineSessionId = null;
  let baselineSequence = null;
  let baselineInstanceIds = null;

  async function acceptBaseline(snapshot, reconcile = async () => true) {
    if (!snapshot || snapshot.complete !== true
      || typeof snapshot.trackerSessionId !== 'string'
      || !Array.isArray(snapshot.windows)) return { outcome: 'incomplete', events: [] };
    const sequence = Number(snapshot.sequence);
    const isStale = () => baselineInstanceIds && snapshot.trackerSessionId === baselineSessionId
      && Number.isSafeInteger(sequence) && Number.isSafeInteger(baselineSequence)
      && sequence < baselineSequence;
    if (isStale()) return { outcome: 'stale', events: [] };
    const live = new Set(snapshot.windows.map((entry) => entry?.windowInstanceId)
      .filter((id) => typeof id === 'string' && /^W[0-9a-f]{16}$/i.test(id)));
    const first = baselineInstanceIds === null;
    const events = first ? [] : [...live]
      .filter((id) => !baselineInstanceIds.has(id))
      .map((windowInstanceId) => ({ kind: 'open', windowInstanceId }));
    let reconciled = false;
    try { reconciled = await reconcile(snapshot) === true; } catch { /* retry from the next complete baseline */ }
    if (!reconciled) return { outcome: 'reconciliation-failed', events: [] };
    // Another complete baseline may have finished its durable reconciliation
    // while this one was awaiting the writer. Do not roll the accepted set back.
    if (isStale()) return { outcome: 'stale', events: [] };
    baselineInstanceIds = live;
    baselineSessionId = snapshot.trackerSessionId;
    baselineSequence = Number.isSafeInteger(sequence) ? sequence : null;
    return { outcome: first ? 'seeded' : 'accepted', events };
  }

  function report(stage, value) {
    const outcome = value === 'success' ? 'success'
      : value === 'ambiguous' ? 'ambiguous'
        : value === 'timeout' ? 'timeout'
          : value === 'helper-unavailable' || value === 'resolve-failed' ? 'helper-unavailable'
            : value === 'missing' || value === 'unresolved' || value === 'invalid' ? 'missing'
              : value === 'disabled' || value === 'duplicate' || value === 'suppressed' || value === 'skipped' ? 'skipped'
                : 'failed';
    try { void Promise.resolve(onDiagnostic({ stage, outcome })).catch(() => {}); } catch { /* diagnostic only */ }
  }

  async function addFromEvent(event) {
    const instanceId = event?.windowInstanceId;
    if (typeof instanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(instanceId)) {
      report('auto-add-resolve', 'invalid');
      return { outcome: 'invalid' };
    }
    const initialLayout = (getState().windowLayouts ?? []).find((layout) => layout.tracking?.enabled === true);
    if (!initialLayout) { report('auto-add-resolve', 'disabled'); return { outcome: 'disabled' }; }
    if ((initialLayout.arrangement?.members ?? []).some((member) => member.descriptor?.windowInstanceId === instanceId)) {
      report('auto-add-resolve', 'duplicate');
      return { outcome: 'duplicate' };
    }
    if (initialLayout.tracking?.suppressedInstanceIds?.includes(instanceId)) {
      report('auto-add-resolve', 'suppressed');
      return { outcome: 'suppressed' };
    }

    // A live lifecycle OPEN now carries the persisted-safe descriptor captured
    // by the SAME native enumeration that discovered the window. Bind from that
    // identity directly. Asking a second existence question first races the
    // event against a later task-list snapshot; a transient omission can answer
    // `missing` and prevent the exact bind path from ever running.
    let resolved = null;
    const lifecycleDescriptor = event?.descriptor;
    if (lifecycleDescriptor?.version === 1
      && lifecycleDescriptor.windowInstanceId === instanceId
      && typeof resolveWindowDescriptor === 'function') {
      try {
        resolved = await resolveWindowDescriptor(lifecycleDescriptor);
      } catch {
        report('auto-add-resolve', 'helper-unavailable');
        return { outcome: 'resolve-failed' };
      }
    } else {
      // Compatibility/recovery path for older hosts and baseline-diff events,
      // which carry only a WID. The existence probe supplies the descriptor;
      // capability-free probes are then rebound through the exact host path.
      let probe;
      try {
        probe = await resolveWindowInstance(instanceId);
      } catch {
        report('auto-add-resolve', 'helper-unavailable');
        return { outcome: 'resolve-failed' };
      }
      if (probe?.outcome !== 'success' || !probe.descriptor
        || probe.descriptor.windowInstanceId !== instanceId) {
        report('auto-add-resolve', probe?.outcome && probe.outcome !== 'success' ? probe.outcome : 'missing');
        return { outcome: 'unresolved' };
      }
      resolved = probe;
    }
    if (!resolved?.capability) {
      if (typeof resolveWindowDescriptor !== 'function') {
        report('auto-add-resolve', 'missing');
        return { outcome: 'unresolved' };
      }
      try {
        resolved = await resolveWindowDescriptor(resolved.descriptor);
      } catch {
        report('auto-add-resolve', 'helper-unavailable');
        return { outcome: 'resolve-failed' };
      }
    }
    if (resolved?.outcome !== 'success' || !resolved.capability || !resolved.descriptor
      || resolved.descriptor.windowInstanceId !== instanceId) {
      report('auto-add-resolve', resolved?.outcome && resolved.outcome !== 'success' ? resolved.outcome : 'missing');
      return { outcome: 'unresolved' };
    }
    report('auto-add-resolve', 'success');
    let observed;
    try {
      observed = await observeWindowCapability(resolved.capability);
    } catch {
      report('auto-add-observe', 'helper-unavailable');
      return { outcome: 'unobserved' };
    }
    if (observed?.outcome !== 'success') {
      report('auto-add-observe', observed?.outcome ?? 'failed');
      return { outcome: 'unobserved' };
    }
    if (typeof observed.observation?.windowInstanceId === 'string'
      && observed.observation.windowInstanceId !== instanceId) {
      report('auto-add-observe', 'missing');
      return { outcome: 'unobserved' };
    }
    report('auto-add-observe', 'success');

    const currentState = getState();
    const currentLayout = (currentState.windowLayouts ?? []).find((layout) =>
      layout.id === initialLayout.id && layout.tracking?.enabled === true);
    if (!currentLayout) { report('auto-add-commit', 'skipped'); return { outcome: 'disabled' }; }
    if ((currentLayout.arrangement?.members ?? []).some((member) => member.descriptor?.windowInstanceId === instanceId)) {
      report('auto-add-commit', 'skipped');
      return { outcome: 'duplicate' };
    }
    if (currentLayout.tracking?.suppressedInstanceIds?.includes(instanceId)) {
      report('auto-add-commit', 'skipped');
      return { outcome: 'suppressed' };
    }

    const member = {
      id: createMemberId(),
      descriptor: resolved.descriptor,
      bounds: observed.observation?.bounds ?? event.observation?.bounds ?? null,
      state: observed.observation?.state === 'minimized' ? 'minimized' : 'normal',
    };
    const nextState = addWindowLayoutMember(currentState, currentLayout.id, member);
    if (nextState === currentState) { report('auto-add-commit', 'skipped'); return { outcome: 'duplicate' }; }
    try {
      if (!(await commit(nextState))) { report('auto-add-commit', 'failed'); return { outcome: 'persistence-failed' }; }
    } catch {
      report('auto-add-commit', 'failed');
      return { outcome: 'persistence-failed' };
    }
    report('auto-add-commit', 'success');
    try {
      await onCommitted({ layoutId: currentLayout.id, member, capability: resolved.capability });
    } catch {
      // Membership is already durable; notification failures cannot turn an
      // added member into a failed result or prevent later lifecycle events.
    }
    return { outcome: 'added', layoutId: currentLayout.id, member };
  }

  return { addFromEvent, acceptBaseline };
}
