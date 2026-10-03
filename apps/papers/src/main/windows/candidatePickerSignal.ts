export type CandidatePickerIntent =
  | { action: 'select' | 'close' | 'peek'; candidateId: string }
  | { action: 'cancel' | 'peek-end' | 'direct-pick'; candidateId: null };

const ACTIONS = new Set([
  'select',
  'close',
  'cancel',
  'peek',
  'peek-end',
  'direct-pick',
] as const);

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function candidateIntent(
  action: unknown,
  candidateId: unknown,
  candidateIds: ReadonlySet<string>,
): CandidatePickerIntent | null {
  if (typeof action !== 'string' || !ACTIONS.has(action as never)) return null;
  if (typeof candidateId !== 'string' || Buffer.byteLength(candidateId, 'utf8') > 512) return null;

  if (action === 'select' || action === 'close' || action === 'peek') {
    if (!candidateIds.has(candidateId)) return null;
    return { action, candidateId };
  }
  if (action === 'cancel' || action === 'peek-end' || action === 'direct-pick') {
    return { action, candidateId: null };
  }
  return null;
}

/** Fail-closed parser for the candidate-picker preload IPC envelope. */
export function parseCandidatePickerSignal(
  raw: unknown,
  candidateIds: ReadonlySet<string>,
): CandidatePickerIntent | null {
  if (!plainObject(raw)) return null;
  if (Object.keys(raw).some((key) => key !== 'action' && key !== 'candidateId')) return null;
  return candidateIntent(raw.action, raw.candidateId, candidateIds);
}

/** Same semantic intent parser for the legacy/navigation signal path. */
export function parseCandidatePickerNavigation(
  target: string,
  candidateIds: ReadonlySet<string>,
): CandidatePickerIntent | null {
  try {
    const url = new URL(target);
    if (url.host !== 'papers-picker.invalid') return null;
    if (url.pathname === '/cancel') return { action: 'cancel', candidateId: null };
    if (url.pathname === '/direct-pick') return { action: 'direct-pick', candidateId: null };
    if (url.pathname === '/peek-end') return { action: 'peek-end', candidateId: null };

    const routes = [
      ['/select/', 'select'],
      ['/close/', 'close'],
      ['/peek/', 'peek'],
    ] as const;
    for (const [prefix, action] of routes) {
      if (!url.pathname.startsWith(prefix)) continue;
      const candidateId = decodeURIComponent(url.pathname.slice(prefix.length));
      return candidateIntent(action, candidateId, candidateIds);
    }
    return null;
  } catch {
    return null;
  }
}
