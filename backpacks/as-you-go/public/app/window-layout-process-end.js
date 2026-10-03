/** End the process represented by one exact row from the currently open picker.
 * Candidate ids are ephemeral capabilities: if the exact id is stale, refuse
 * the action instead of trying to recover a similarly named application. */
export async function endExactWindowCandidateProcess({
  candidateId,
  candidates,
  bindWindowCandidate,
  endProcessWindowCapability,
}) {
  if (!Array.isArray(candidates) || !candidates.some((candidate) => candidate.id === candidateId)) {
    return { outcome: 'missing', error: 'Window is no longer available' };
  }

  const bound = await bindWindowCandidate(candidateId);
  if (bound?.outcome !== 'success') {
    return {
      outcome: bound?.outcome ?? 'failed',
      error: bound?.error ?? 'Window is no longer available',
    };
  }

  const ended = await endProcessWindowCapability(bound.capability);
  if (ended?.outcome !== 'success') {
    return {
      outcome: ended?.outcome ?? 'failed',
      error: ended?.error ?? 'Process could not be ended',
    };
  }
  return { outcome: 'success', descriptor: bound.descriptor };
}
