/** Resolve artwork only from the exact window instance that owns a member. */
export function windowLayoutMemberIcon(member, candidates) {
  const instanceId = member?.descriptor?.windowInstanceId;
  if (typeof instanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(instanceId)
    || !Array.isArray(candidates)) return null;
  const matches = candidates.filter((candidate) => candidate?.windowInstanceId === instanceId);
  if (matches.length !== 1) return null;
  return typeof matches[0].icon === 'string' && matches[0].icon.length > 0
    ? matches[0].icon
    : null;
}
