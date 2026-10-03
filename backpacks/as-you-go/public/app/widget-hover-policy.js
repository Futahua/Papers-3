import { planQuickRunTypeToRun } from './quick-run/quick-run-type-to-run.js';

const HOVER_POLICY_FAILURE_MESSAGE = '[AYG] Quick Run hover policy was not acknowledged';

/** Report one fixed diagnostic per failure episode; a later acknowledgement re-arms it. */
export function createWidgetHoverPolicyDiagnostics({ debug = console.debug } = {}) {
  if (typeof debug !== 'function') throw new TypeError('debug must be a function');
  let failureReported = false;
  return Object.freeze({
    onPublishFailure() {
      if (failureReported) return;
      failureReported = true;
      debug(HOVER_POLICY_FAILURE_MESSAGE);
    },
    onPublishSuccess() {
      failureReported = false;
    },
  });
}

/** Keep widget Quick Run input enabled only while the pointer is over the widget. */
export function createWidgetHoverPolicy({ publish, onPublishFailure = () => undefined, onPublishSuccess = () => undefined } = {}) {
  if (typeof publish !== 'function') throw new TypeError('publish must be a function');
  if (typeof onPublishFailure !== 'function' || typeof onPublishSuccess !== 'function') {
    throw new TypeError('publish result callbacks must be functions');
  }
  let hovered = false;
  let workspaceEnabled = false;
  let blockedBindings = [];
  let lastPublished = null;

  function publishCurrent(force = false) {
    const enabled = hovered && workspaceEnabled;
    const signature = `${enabled ? 1 : 0}:${blockedBindings.join('\u0000')}`;
    if (!force && signature === lastPublished) return;
    lastPublished = signature;
    let result;
    try {
      result = publish(enabled, blockedBindings);
    } catch {
      lastPublished = null;
      onPublishFailure();
      return;
    }
    Promise.resolve(result).then((value) => {
      if (value === false || value?.ok === false || value?.acknowledged === false
        || (typeof value?.outcome === 'string' && value.outcome !== 'success')) {
        lastPublished = null;
        onPublishFailure();
        return;
      }
      onPublishSuccess();
    }).catch(() => {
      lastPublished = null;
      onPublishFailure();
    });
  }

  return Object.freeze({
    updateWorkspacePolicy(enabled, bindings) {
      workspaceEnabled = enabled === true;
      blockedBindings = Array.isArray(bindings) ? [...bindings] : [];
      // The native hook expires a policy after 1200 ms. The workspace sends
      // this policy every 400 ms, so refresh it while hovered even unchanged.
      publishCurrent(hovered);
    },
    setHovered(next) {
      const value = next === true;
      if (hovered === value) return;
      hovered = value;
      publishCurrent(true);
    },
    isHovered: () => hovered,
    planInput(event, context) {
      if (!hovered) return { kind: 'pass', reason: 'pointer-not-hovering' };
      return planQuickRunTypeToRun(event, context);
    },
    dispose() {
      hovered = false;
      workspaceEnabled = false;
      publishCurrent(true);
    },
  });
}
