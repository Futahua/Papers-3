/** Opens the native chooser before the potentially slow candidate enumeration.
 * The picker id ties the later row update to this exact live shell. If the user
 * dismisses it first, the eventual enumeration is ignored. */
export function toWindowLayoutPickerRows(candidates, members, isMember) {
  const currentMembers = Array.isArray(members) ? members : [];
  const predicate = typeof isMember === 'function' ? isMember : () => false;
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    icon: candidate.icon ?? null,
    current: predicate(currentMembers, candidate),
  }));
}

export async function openWindowLayoutPickerSession({
  pickerId,
  openPicker,
  loadCandidates,
  updatePicker,
  isCurrent = () => true,
}) {
  if (typeof pickerId !== 'string' || pickerId.length === 0
    || typeof openPicker !== 'function'
    || typeof loadCandidates !== 'function'
    || typeof updatePicker !== 'function') {
    throw new TypeError('window picker session requires an id and picker/list adapters');
  }

  // Invoke these synchronously in order so Papers starts showing its loading
  // shell before candidate listing can contend with helper/icon work.
  let actionPromise;
  try { actionPromise = Promise.resolve(openPicker(pickerId)); } catch (error) {
    actionPromise = Promise.reject(error);
  }
  const actionOutcome = actionPromise.then(
    (action) => ({ kind: 'action', action }),
    (error) => ({ kind: 'picker-error', error }),
  );
  let candidatesPromise;
  try { candidatesPromise = Promise.resolve(loadCandidates()); } catch (error) {
    candidatesPromise = Promise.reject(error);
  }
  const candidatesOutcome = candidatesPromise.then(
    (result) => ({ kind: 'candidates', result }),
    (error) => ({ kind: 'list-error', error }),
  );

  const first = await Promise.race([actionOutcome, candidatesOutcome]);
  if (first.kind === 'action') return { outcome: 'action', action: first.action, actionPromise, candidates: [] };
  if (first.kind === 'picker-error') return { outcome: 'picker-error', error: first.error, actionPromise, candidates: [] };
  if (!isCurrent()) return { outcome: 'stale', actionPromise, candidates: [] };

  const result = first.kind === 'candidates' ? first.result : null;
  const success = result?.outcome === 'success' && Array.isArray(result.candidates);
  const candidates = success ? result.candidates : [];
  // Empty update clears loading on both an empty list and an enumeration error.
  // The caller owns the user-facing error status and dismisses failed sessions.
  let delivery;
  try { delivery = await updatePicker(candidates, pickerId); } catch (error) {
    return { outcome: 'update-error', error, actionPromise, candidates: [] };
  }
  if (delivery?.outcome !== 'success'
    || !['applied', 'buffered'].includes(delivery.delivery)) {
    return { outcome: 'update-error', error: delivery?.outcome ?? 'failed', actionPromise, candidates: [] };
  }
  if (!isCurrent()) return { outcome: 'stale', actionPromise, candidates: [] };
  return {
    outcome: success ? 'success' : 'list-error',
    error: first.kind === 'list-error' ? first.error : result?.error,
    actionPromise,
    candidates,
  };
}
