/**
 * 019C (RoketPuncha sole-editor lane): the workspace-side durable writers the
 * entry wires. The workspace is the SOLE durable writer; these factories only
 * mutate through the injected model/commit hooks and never touch the widget
 * channel or recording persistence directly.
 *
 * - createWindowLayoutPickApplier: applies Winter's one typed committed pick
 *   set - every remove data-only, every successful add capability/descriptor -
 *   and persists ONCE through commitState. Cancel is byte-zero. Partial add
 *   failures are counted, never fatal.
 * - createWindowLayoutRetirementWriter: applies Ning's onRetireMember intent to
 *   one data-only removal/save; ignores the intent when the member or layout no
 *   longer exists. Never persists counters.
 *
 * 040: every capability/icon cache entry is keyed by the composite
 * `layoutId\u0000memberId` identity (the same key the pure runtime uses), so a
 * member cached for one layout never leaks into another layout that happens to
 * reference the same real window. The key function is injected so the entry and
 * these writers provably agree on one composite identity.
 */
import { windowLayoutMemberKey } from './window-layout-runtime.js';

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validWindowInstanceId(value) {
  return typeof value === 'string' && /^W[0-9a-f]{16}$/i.test(value);
}

function validExecutableFingerprint(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** Compare descriptors across identity generations.
 * Exact ids decide when both exist. For a mixed WID/legacy pair, a shared
 * executable fingerprint stays ambiguous across title changes; differing
 * valid fingerprints allow an add. Papers defines this fingerprint as a hash
 * of the normalized process image path, so this bridge relies on stable path
 * reporting across observations. It does not identify file contents or a
 * process. Missing or malformed fingerprints remain ambiguous. Both-legacy
 * matching retains the title+fingerprint pair. */
function windowDescriptorIdentityRelation(memberDescriptor, pickedDescriptor) {
  if (!isPlainObject(memberDescriptor) || !isPlainObject(pickedDescriptor)) return 'different';
  const memberHasInstanceIdentity = memberDescriptor.windowInstanceId !== undefined;
  const pickedHasInstanceIdentity = pickedDescriptor.windowInstanceId !== undefined;
  const memberHasValidInstanceIdentity = validWindowInstanceId(memberDescriptor.windowInstanceId);
  const pickedHasValidInstanceIdentity = validWindowInstanceId(pickedDescriptor.windowInstanceId);
  if (memberHasInstanceIdentity || pickedHasInstanceIdentity) {
    if ((memberHasInstanceIdentity && !memberHasValidInstanceIdentity)
      || (pickedHasInstanceIdentity && !pickedHasValidInstanceIdentity)) return 'ambiguous';
    if (memberHasValidInstanceIdentity && pickedHasValidInstanceIdentity) {
      return memberDescriptor.windowInstanceId === pickedDescriptor.windowInstanceId ? 'same' : 'different';
    }
    const executableIdentityAvailable = validExecutableFingerprint(memberDescriptor.executableFingerprint)
      && validExecutableFingerprint(pickedDescriptor.executableFingerprint);
    if (executableIdentityAvailable
      && memberDescriptor.executableFingerprint !== pickedDescriptor.executableFingerprint) return 'different';
    return 'ambiguous';
  }
  const executableIdentityAvailable = validExecutableFingerprint(memberDescriptor.executableFingerprint)
    && validExecutableFingerprint(pickedDescriptor.executableFingerprint);
  const executableMatches = executableIdentityAvailable
    && memberDescriptor.executableFingerprint === pickedDescriptor.executableFingerprint;
  const pairMatches = typeof memberDescriptor.title === 'string'
    && typeof pickedDescriptor.title === 'string'
    && executableMatches
    && memberDescriptor.title === pickedDescriptor.title;
  return pairMatches ? 'same' : 'different';
}

export function windowLayoutHasValidInstanceId(value) {
  return isPlainObject(value) && validWindowInstanceId(value.windowInstanceId);
}

/** The native Direct Pick seed keeps exact instance ids when available so the
 * host can distinguish same-title siblings. Legacy descriptors still collapse
 * by title and executable fingerprint; malformed present ids fail closed
 * rather than being silently downgraded to that weaker identity. */
export function windowLayoutPickMemberDescriptors(members) {
  const unique = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    const descriptor = member?.descriptor ?? member;
    if (!isPlainObject(descriptor) || descriptor.version !== 1
      || typeof descriptor.title !== 'string'
      || typeof descriptor.executableFingerprint !== 'string') continue;
    const hasInstanceId = descriptor.windowInstanceId !== undefined;
    if (hasInstanceId && !validWindowInstanceId(descriptor.windowInstanceId)) return null;
    const identity = hasInstanceId
      ? `window:${descriptor.windowInstanceId}`
      : `legacy:${descriptor.executableFingerprint}|${descriptor.title}`;
    if (!unique.has(identity)) {
      unique.set(identity, {
        version: 1,
        title: descriptor.title,
        executableFingerprint: descriptor.executableFingerprint,
        ...(hasInstanceId ? { windowInstanceId: descriptor.windowInstanceId } : {}),
      });
    }
  }
  return [...unique.values()];
}

/** Candidate rows have an exact host-observed identity, but no persisted
 * executable fingerprint. Only an exact, valid instance id can establish
 * current membership before binding; title-only matching can confuse sibling
 * windows and retitled members. Duplicate persisted ids still count as current
 * here, while the commit applier refuses their ambiguous removal. */
export function windowLayoutCandidateIsMember(members, candidate) {
  if (!windowLayoutHasValidInstanceId(candidate)) return false;
  return (Array.isArray(members) ? members : []).some((member) =>
    windowDescriptorIdentityRelation(member?.descriptor, candidate) === 'same');
}

export function windowLayoutPickForBoundCandidate(members, bound, candidate = null) {
  if (!isPlainObject(bound) || !isPlainObject(bound.descriptor)) return null;
  const descriptor = bound.descriptor;
  const current = Array.isArray(members) ? members : [];
  if (descriptor.windowInstanceId !== undefined && !validWindowInstanceId(descriptor.windowInstanceId)) return null;
  if (descriptor.windowInstanceId === undefined
    && !validExecutableFingerprint(descriptor.executableFingerprint)) return null;
  if (isPlainObject(candidate) && candidate.windowInstanceId !== undefined
    && (!validWindowInstanceId(candidate.windowInstanceId)
      || !validWindowInstanceId(descriptor.windowInstanceId)
      || candidate.windowInstanceId !== descriptor.windowInstanceId)) return null;
  const relations = current.map((member) =>
    windowDescriptorIdentityRelation(member?.descriptor, descriptor));
  if (relations.includes('ambiguous')) return null;
  const isMember = relations.includes('same');
  return isMember
    ? { outcome: 'committed', adds: [], removes: [{ descriptor }] }
    : { outcome: 'committed', adds: [{ descriptor, capability: bound.capability, candidate }], removes: [] };
}

/** A native-list remove intent can only remove this exact bound identity.
 * Unlike a toggle pick, absence is a no-op and can never turn into an add. */
export function windowLayoutRemoveForBoundCandidate(members, bound) {
  if (!isPlainObject(bound) || !isPlainObject(bound.descriptor)) return null;
  const descriptor = bound.descriptor;
  const current = Array.isArray(members) ? members : [];
  const isMember = current.some((member) => sameWindowDescriptorIdentity(member?.descriptor, descriptor));
  return {
    outcome: 'committed',
    adds: [],
    removes: isMember ? [{ descriptor }] : [],
  };
}

export function createWindowLayoutPickApplier({
  getState,
  commitState,
  observeCapability,
  model,
  capabilities,
  icons,
  iconCacheEntry = (_member, icon) => icon,
  isReadOnly = () => false,
  memberKey = windowLayoutMemberKey,
}) {
  /**
   * Every member of a layout whose persisted descriptor IS the one the pick named.
   *
   * This used to match on the descriptor's TITLE alone, and that was the last place in this project that found
   * a member by a mutable, non-unique string. A picker-commit removal carries exactly one thing - a persisted
   * descriptor, `{version, title, executableFingerprint}` - because the wire parser rejects any other key, and
   * even the caller that holds a member id in hand sends the descriptor alone. So the narrowest identity a
   * removal actually carries is that PAIR, and a pair is only usable when exactly one member carries it: two
   * windows of one application can share a title, and a title is not identity - the same defect the host fixed
   * on its session-token path. Returning every match is what lets the caller refuse rather than take whichever
   * happened to come first in the layout.
   */
  function membersForDescriptor(next, layoutId, descriptor) {
    if (!isPlainObject(descriptor)) return [];
    if (descriptor.windowInstanceId !== undefined && !validWindowInstanceId(descriptor.windowInstanceId)) return [];
    if (descriptor.windowInstanceId === undefined
      && (!validExecutableFingerprint(descriptor.executableFingerprint) || typeof descriptor.title !== 'string')) return [];
    return (next.windowLayouts ?? [])
      .find((layout) => layout.id === layoutId)
      ?.arrangement?.members
      ?.map((member) => ({ member, relation: windowDescriptorIdentityRelation(member?.descriptor, descriptor) })) ?? [];
  }
  async function apply(layoutId, result) {
    if (!isPlainObject(result) || result.outcome === 'cancelled') return { outcome: 'cancelled' };
    if (result.outcome !== 'committed') return { outcome: 'failed', error: result.error ?? 'pick failed' };
    if (isReadOnly()) return { outcome: 'superseded' };
    const adds = Array.isArray(result.adds) ? result.adds : [];
    const removes = Array.isArray(result.removes) ? result.removes : [];
    let removed = 0;
    let added = 0;
    let failures = 0;
    // A removal the pick named but this layout cannot resolve to exactly one member. Counted and reported
    // rather than skipped silently: "nothing happened" and "I could not tell which member you meant" look
    // identical to the caller otherwise.
    let unmatched = 0;
    let ambiguous = 0;
    // 019DR2: stage ALL runtime-map changes locally. The durable state and the
    // capability/icon maps must commit TOGETHER or not at all, so a superseded
    // mid-observation apply cannot leave a retained member without its
    // binding/icon or orphan entries for an uncommitted new member.
    const capabilityDeletes = new Set();
    const iconDeletes = new Set();
    const capabilitySets = new Map();
    const iconSets = new Map();
    const stagedAdds = [];
    for (const add of adds) {
      if (!isPlainObject(add) || !isPlainObject(add.descriptor) || !isPlainObject(add.capability)) {
        failures += 1;
        continue;
      }
      if ((add.descriptor.windowInstanceId !== undefined && !validWindowInstanceId(add.descriptor.windowInstanceId))
        || (add.descriptor.windowInstanceId === undefined
          && !validExecutableFingerprint(add.descriptor.executableFingerprint))) {
        failures += 1;
        continue;
      }
      let observed;
      try {
        observed = await observeCapability(add.capability);
      } catch {
        observed = null;
      }
      if (!observed || observed.outcome !== 'success' || !observed.observation) {
        failures += 1;
        continue;
      }
      const memberId = generateId();
      const member = {
        id: memberId,
        descriptor: add.descriptor,
        bounds: observed.observation.bounds ?? null,
        state: observed.observation.state === 'minimized' ? 'minimized' : 'normal',
      };
      stagedAdds.push({ member, capability: add.capability, icon: add.candidate?.icon ?? null });
    }
    // Host observations above may take long enough for another surface or
    // lifecycle writer to install a newer document. Rebase every requested
    // add/remove onto that latest state; never commit the pre-await snapshot.
    const baseState = getState();
    let next = baseState;
    for (const remove of removes) {
      const classified = membersForDescriptor(next, layoutId, remove?.descriptor);
      if (classified.some((entry) => entry.relation === 'ambiguous')) {
        ambiguous += 1;
        continue;
      }
      const matches = classified.filter((entry) => entry.relation === 'same').map((entry) => entry.member);
      if (matches.length === 0) {
        // No member carries this descriptor: the window was retitled, or it is not in this layout at all.
        // Removing nothing is the only safe answer - the pick cannot name a member it did not match.
        unmatched += 1;
        continue;
      }
      if (matches.length > 1) {
        // More than one member carries it, so the pick does not say which; refusing beats removing the wrong
        // window, and beats removing both.
        ambiguous += 1;
        continue;
      }
      const existing = matches[0];
      next = model.removeWindowLayoutMember(next, layoutId, existing.id, { source: 'pick-remove', reason: 'the pick asked for this window to be removed' });
      capabilityDeletes.add(memberKey(layoutId, existing.id));
      iconDeletes.add(memberKey(layoutId, existing.id));
      removed += 1;
    }
    for (const { member, capability, icon } of stagedAdds) {
      const existingMembers = (next.windowLayouts ?? [])
        .find((layout) => layout.id === layoutId)
        ?.arrangement?.members ?? [];
      const relations = existingMembers.map((existing) =>
        windowDescriptorIdentityRelation(existing?.descriptor, member.descriptor));
      if (relations.includes('ambiguous')) {
        // State may have gained a same-title/executable member of another
        // identity generation while this add was observing its capability.
        // Refuse that plausible alias after rebasing as well.
        failures += 1;
        continue;
      }
      // A peer may have committed the same pick while our host observation
      // was pending. Treat that as idempotent rather than overwriting the
      // peer's newer member list or adding a duplicate.
      if (relations.includes('same')) continue;
      try {
        next = model.addWindowLayoutMember(next, layoutId, member);
      } catch {
        failures += 1;
        continue;
      }
      capabilitySets.set(memberKey(layoutId, member.id), capability);
      if (icon) iconSets.set(memberKey(layoutId, member.id), iconCacheEntry(member, icon));
      added += 1;
    }
    // 019DR2 transactional boundary: re-check read-only, THEN commit state and
    // apply the staged runtime-map changes as one accepted path. A superseded
    // apply must leave state, capabilities and icons untouched.
    const hasChanges = next !== baseState
      || capabilityDeletes.size > 0 || capabilitySets.size > 0
      || iconDeletes.size > 0 || iconSets.size > 0;
    if (hasChanges) {
      if (isReadOnly()) return { outcome: 'superseded' };
      // The store installs optimistic state synchronously, but the returned
      // Promise is the durable boundary (including a forwarded writer ACK).
      // Do not mutate ephemeral capability/icon maps until that boundary has
      // succeeded, or a failed save leaves runtime and durable membership apart.
      let pendingCommit = null;
      if (next !== baseState) {
        try {
          pendingCommit = commitState(next);
        } catch (error) {
          return {
            outcome: 'failed',
            error: error instanceof Error ? error.message : String(error ?? 'Window layout persistence failed'),
          };
        }
      }
      if (pendingCommit !== null) {
        try {
          const committed = await pendingCommit;
          if (committed === false) {
            return { outcome: 'failed', error: 'Window layout persistence failed' };
          }
        } catch (error) {
          return {
            outcome: 'failed',
            error: error instanceof Error ? error.message : String(error ?? 'Window layout persistence failed'),
          };
        }
      }
      for (const key of capabilityDeletes) capabilities?.delete(key);
      for (const key of iconDeletes) icons?.delete(key);
      for (const [key, capability] of capabilitySets) capabilities?.set(key, capability);
      for (const [key, icon] of iconSets) icons?.set(key, icon);
    }
    return { outcome: 'committed', added, removed, failures, unmatched, ambiguous };
  }
  return { apply };
}

/**
 * What a committed pick result is worth, as two answers the caller must not conflate.
 *
 * `mutated` - did anything actually change? A pick whose removals were all refused (no member carried the
 * descriptor, or two did) and whose adds all failed changes nothing, and the caller must treat it as nothing:
 * it must not tell the widget channel a layout was committed, and above all it must not ensure recording,
 * because that is what ACTIVATES a layout, persists it as the recording context, and applies real windows.
 * A pure refusal that activated a layout the creator was not using would be a side effect of a no-op.
 *
 * `statusText` - what to say. The old wording asserted "nothing was removed" whenever a removal was refused,
 * which is false the moment some removals in the same array succeeded. It is now decided by `removed`:
 * nothing removed says so, a partial result reports both halves.
 */
export function windowLayoutPickApplyOutcome(applied) {
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);
  const added = count(applied?.added);
  const removed = count(applied?.removed);
  const failures = count(applied?.failures);
  const unmatched = count(applied?.unmatched);
  const ambiguous = count(applied?.ambiguous);
  const refused = ambiguous + unmatched;
  const reason = [
    ambiguous > 0 ? `${ambiguous} matched two windows` : null,
    unmatched > 0 ? `${unmatched} could not be matched` : null,
  ].filter(Boolean).join('; ');
  let statusText = '';
  if (failures > 0) {
    // Unchanged wording, unchanged priority: an add that could not be bound is the first thing to report.
    statusText = `${failures} member${failures === 1 ? '' : 's'} could not be added`;
  } else if (refused > 0 && removed === 0) {
    // Nothing was removed, so saying so is accurate - and the reason still has to be said, because a removal
    // that found no member and a removal that found two look identical from the outside.
    statusText = ambiguous > 0 && unmatched === 0
      ? 'Two windows here match that one — nothing was removed'
      : unmatched > 0 && ambiguous === 0
        ? 'That window has changed since the pick — nothing was removed'
        : `Nothing was removed — ${reason}`;
  } else if (refused > 0) {
    // A partial result: some members went, some did not. Reporting only the removals would hide the refusal,
    // and reporting only the refusal would hide the removals.
    statusText = `Removed ${removed} — ${reason}`;
  }
  // A failed add is not a mutation either: nothing in the layout changed, so nothing is committed or activated.
  return { mutated: added > 0 || removed > 0, statusText };
}

export function createWindowLayoutRetirementWriter({
  getState,
  commitState,
  model,
  capabilities,
  icons,
  memberKey = windowLayoutMemberKey,
}) {
  function retire(layoutId, memberId) {
    const layout = getState().windowLayouts?.find((candidate) => candidate.id === layoutId);
    const member = layout?.arrangement?.members?.find((candidate) => candidate.id === memberId);
    if (!member) return { outcome: 'ignored' };
    const next = model.removeWindowLayoutMember(getState(), layoutId, memberId, { source: 'watcher-retire', reason: 'a retirement command removed this member' });
    capabilities?.delete(memberKey(layoutId, memberId));
    icons?.delete(memberKey(layoutId, memberId));
    if (next !== getState()) commitState(next);
    return { outcome: 'removed' };
  }
  return { retire };
}
