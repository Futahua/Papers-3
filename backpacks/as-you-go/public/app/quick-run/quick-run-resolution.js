// Resolving a Layout Item to a live window, as a decision rather than a call (section 10).
//
// The contract draws a hard line here and this module is that line: resolution either finds exactly one
// window, or it reports missing or ambiguous - it never picks a plausible substitute, and it never
// activates anything. The native half (asking the host for the windows, then raising or restoring one)
// waits for a session at the machine and for the Papers-side capability; what can be built and tested now
// is the decision, which is where "never silently substitutes" actually lives.
//
// Matching is fail-closed: only the descriptor fields the member declares are compared, every one of them
// must match exactly, and a descriptor that declares nothing matches nothing. A near-miss is a miss.
//
// The field vocabulary is not repeated here. The persisted descriptor's identity fields are pinned once, in
// quick-run-types.js, and this module reads that list: an earlier version kept a private copy that compared
// `executable` and `fingerprint`, names that never appear on a persisted member, so a member whose
// fingerprint differed would have matched on its title alone.
import { declaredDescriptorFields } from './quick-run-types.js';

export const QUICK_RUN_RESOLUTION_UNIQUE = 'unique';
export const QUICK_RUN_RESOLUTION_MISSING = 'missing';
export const QUICK_RUN_RESOLUTION_AMBIGUOUS = 'ambiguous';

function matches(window, descriptor, fields) {
  if (!window || typeof window !== 'object') return false;
  return fields.every((field) => window[field] === descriptor[field]);
}

function identityOf(window) {
  // Whatever the host uses to name a window: the first of these that it provides. The module does not
  // invent an identity, and a window without one is still reported so the caller can see it.
  for (const field of ['id', 'hwnd', 'pid', 'title']) {
    if (window?.[field] !== undefined && window[field] !== null && window[field] !== '') return window[field];
  }
  return null;
}

/**
 * Resolve a member against the windows the host reported. Returns a typed outcome and, for a unique
 * resolution, the window itself; for an ambiguous one, the candidate identities rather than a choice.
 */
export function resolveQuickRunMember(member, windows) {
  const descriptor = member?.descriptor;
  const fields = declaredDescriptorFields(descriptor);
  if (fields.length === 0) {
    return { outcome: QUICK_RUN_RESOLUTION_MISSING, candidates: [], reason: 'descriptor-declares-nothing' };
  }
  const list = Array.isArray(windows) ? windows : [];
  const candidates = list.filter((window) => matches(window, descriptor, fields));
  if (candidates.length === 0) return { outcome: QUICK_RUN_RESOLUTION_MISSING, candidates: [] };
  if (candidates.length > 1) {
    return { outcome: QUICK_RUN_RESOLUTION_AMBIGUOUS, candidates: candidates.map(identityOf) };
  }
  return { outcome: QUICK_RUN_RESOLUTION_UNIQUE, window: candidates[0], candidates: [identityOf(candidates[0])] };
}

/**
 * Section 10.1's ephemeral state after an attempt: a unique resolution that the host then activated is
 * available, and anything else is unavailable. Never "not running" for an untouched item, because an
 * untouched item has not been asked about at all.
 */
export function availabilityAfterResolution(outcome) {
  return outcome === QUICK_RUN_RESOLUTION_UNIQUE ? 'available' : 'unavailable';
}

/**
 * The plan a caller executes: only a unique resolution may activate, and an ambiguous one hands back the
 * candidates so the caller can say why rather than choosing.
 */
export function planQuickRunResolution(member, windows) {
  const resolved = resolveQuickRunMember(member, windows);
  return {
    ...resolved,
    activate: resolved.outcome === QUICK_RUN_RESOLUTION_UNIQUE,
    availability: availabilityAfterResolution(resolved.outcome),
  };
}
