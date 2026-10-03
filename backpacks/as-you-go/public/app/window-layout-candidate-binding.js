/**
 * Owns the short-lived native chooser candidate -> bound window transition.
 *
 * Candidate ids are deliberately ephemeral. A list row is the recovery hint that
 * survives the async user click: if the host reports that id as missing, enumerate
 * once and rebind only when the same title/application row is unambiguous.
 *
 * This module does not decide membership and does not persist anything.
 */
export function createWindowLayoutCandidateBinder({
  bindWindowCandidate,
  listWindowCandidates,
}) {
  if (typeof bindWindowCandidate !== 'function') {
    throw new TypeError('bindWindowCandidate is required');
  }
  if (typeof listWindowCandidates !== 'function') {
    throw new TypeError('listWindowCandidates is required');
  }

  return async function bindWindowLayoutPickerCandidate(candidateId, row) {
    let bound = await bindWindowCandidate(candidateId);
    if (bound?.outcome !== 'missing' || !row) return { bound, row };

    const refreshed = await listWindowCandidates();
    if (refreshed?.outcome !== 'success') return { bound, row };

    const matches = (refreshed.candidates ?? []).filter((candidate) => {
      if (candidate.title !== row.title) return false;
      if (typeof row.applicationLabel === 'string'
        && typeof candidate.applicationLabel === 'string') {
        return candidate.applicationLabel === row.applicationLabel;
      }
      return true;
    });

    if (matches.length !== 1) return { bound, row };

    const reboundRow = matches[0];
    bound = await bindWindowCandidate(reboundRow.id);
    return { bound, row: reboundRow };
  };
}
