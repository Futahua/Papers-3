/**
 * One-shot bridge between Papers and the creator's already-running SlopTop
 * AHK engine.
 *
 * Papers sends one authenticated activation snapshot containing the current
 * layout members as non-persistable PID/bounds identities. AHK then owns all
 * hit-testing, hover rendering and click toggling locally. On Enter it returns
 * one final green-set snapshot; only then does Papers resolve capabilities and
 * route the typed adds/removes. No pointer movement or click crosses this
 * boundary.
 */
import { randomUUID } from 'node:crypto';
import type {
  NativePickerWindowIdentity,
  PersistedWindowMemberDescriptor,
  WindowCapabilityService,
} from './windowCapabilityService';
import { canFallbackLegacyWindowIdentity, compareWindowMemberIdentity } from './windowCapabilityService';
import type { WindowPickResult, WindowPickSession } from './windowPickSession';
import { defaultWindowGeometryJournal } from './windowGeometryJournal';

/** Every Direct Pick outcome that is not a commit lands in the same bounded
 * journal as the rectangles, so "nothing happened" can be read afterwards
 * instead of guessed at. */
function notePickerOutcome(kind: 'picker-open' | 'picker-fail' | 'picker-commit', detail: string): void {
  try {
    defaultWindowGeometryJournal().record({ kind, detail, outcome: kind });
  } catch {
    /* diagnostics never fail the action they describe */
  }
}

/** v3: a committed pick carries POSITIVE removal intent. The final green set is
 * no longer compared against the original members to infer removals, because a
 * member the picker never showed is absent from that set without anyone asking
 * for its removal - which deleted eight members in one gesture. Removals now
 * come only from `deselectedSeedIds`: session-local seed ids the human actually
 * toggled off. */
export const SLOPTOP_PICKER_PROTOCOL_VERSION = 3;
const DEFAULT_ACK_TIMEOUT_MS = 3000;
const DEFAULT_RESULT_POLL_MS = 25;
const MAX_NATIVE_WINDOWS = 64;
const COORDINATE_LIMIT = 65536;

export interface SlopTopPickerActivation {
  version: 3;
  token: string;
  seeds: NativePickerSeedIdentity[];
}

/** A seed carries the index of the member it came from, so the picker can name
 * a removal without re-resolving a native identity that may have moved or
 * closed by the time Enter is pressed. */
export interface NativePickerSeedIdentity extends NativePickerWindowIdentity {
  seedId: number;
}

interface SlopTopPickerCommittedResult {
  version: 3;
  token: string;
  outcome: 'committed';
  windows: NativePickerWindowIdentity[];
  deselectedSeedIds: number[];
}

interface SlopTopPickerCancelledResult {
  version: 3;
  token: string;
  outcome: 'cancelled';
}

type SlopTopPickerResult = SlopTopPickerCommittedResult | SlopTopPickerCancelledResult;

export interface SlopTopPickerTransport {
  activate(request: SlopTopPickerActivation): void | Promise<void>;
  readAck(token: string): unknown | Promise<unknown>;
  readResult(token: string): unknown | Promise<unknown>;
  requestCancel(token: string): void | Promise<void>;
  cleanup(token: string): void | Promise<void>;
}

export interface SlopTopPickerSessionOptions {
  ackTimeoutMs?: number;
  resultPollMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && Math.abs(value) <= COORDINATE_LIMIT;
}

function nativeIdentity(value: unknown): NativePickerWindowIdentity | null {
  if (!object(value) || !exactKeys(value, ['processId', 'x', 'y', 'width', 'height'])) return null;
  if (!boundedInteger(value['processId']) || value['processId'] <= 0) return null;
  if (!boundedInteger(value['x']) || !boundedInteger(value['y'])) return null;
  if (!boundedInteger(value['width']) || !boundedInteger(value['height'])) return null;
  if (value['width'] <= 0 || value['height'] <= 0) return null;
  return {
    processId: value['processId'],
    x: value['x'],
    y: value['y'],
    width: value['width'],
    height: value['height'],
  };
}

function parseResult(value: unknown, token: string): SlopTopPickerResult | null {
  if (!object(value) || value['version'] !== SLOPTOP_PICKER_PROTOCOL_VERSION || value['token'] !== token) return null;
  if (value['outcome'] === 'cancelled') {
    return exactKeys(value, ['version', 'token', 'outcome'])
      ? { version: 3, token, outcome: 'cancelled' }
      : null;
  }
  if (value['outcome'] !== 'committed'
    || !exactKeys(value, ['version', 'token', 'outcome', 'windows', 'deselectedSeedIds'])) return null;
  if (!Array.isArray(value['windows']) || value['windows'].length > MAX_NATIVE_WINDOWS) return null;
  const windows: NativePickerWindowIdentity[] = [];
  const seen = new Set<string>();
  for (const raw of value['windows']) {
    const identity = nativeIdentity(raw);
    if (!identity) return null;
    const key = `${identity.processId}|${identity.x}|${identity.y}|${identity.width}|${identity.height}`;
    if (seen.has(key)) return null;
    seen.add(key);
    windows.push(identity);
  }
  // Positive removal intent only. A malformed id fails the WHOLE commit rather
  // than being filtered out: a partially understood removal is exactly the kind
  // of guess that removed members nobody asked to remove.
  const rawDeselected = value['deselectedSeedIds'];
  if (!Array.isArray(rawDeselected) || rawDeselected.length > MAX_NATIVE_WINDOWS) return null;
  const deselectedSeedIds: number[] = [];
  const seenIds = new Set<number>();
  for (const raw of rawDeselected) {
    if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) >= MAX_NATIVE_WINDOWS) return null;
    if (seenIds.has(raw as number)) return null;
    seenIds.add(raw as number);
    deselectedSeedIds.push(raw as number);
  }
  return { version: 3, token, outcome: 'committed', windows, deselectedSeedIds };
}

function ackMatches(value: unknown, token: string): boolean {
  return object(value)
    && exactKeys(value, ['version', 'token', 'active'])
    && value['version'] === SLOPTOP_PICKER_PROTOCOL_VERSION
    && value['token'] === token
    && value['active'] === true;
}

function descriptorDiff(
  initial: PersistedWindowMemberDescriptor[],
  final: Array<{ descriptor: PersistedWindowMemberDescriptor }>,
): { adds: number[]; removes: number[] } | null {
  const matchesFromInitial = initial.map(() => [] as number[]);
  const matchesFromFinal = final.map(() => [] as number[]);
  for (let initialIndex = 0; initialIndex < initial.length; initialIndex += 1) {
    for (let finalIndex = 0; finalIndex < final.length; finalIndex += 1) {
      const relation = compareWindowMemberIdentity(initial[initialIndex]!, final[finalIndex]!.descriptor);
      if (relation === 'ambiguous' && !canFallbackLegacyWindowIdentity(initial[initialIndex]!, final[finalIndex]!.descriptor)) return null;
      if (relation === 'same' || canFallbackLegacyWindowIdentity(initial[initialIndex]!, final[finalIndex]!.descriptor)) {
        matchesFromInitial[initialIndex]!.push(finalIndex);
        matchesFromFinal[finalIndex]!.push(initialIndex);
      }
    }
  }
  if (matchesFromInitial.some((matches) => matches.length > 1)
    || matchesFromFinal.some((matches) => matches.length > 1)) return null;
  return {
    adds: matchesFromFinal.flatMap((matches, index) => matches.length === 0 ? [index] : []),
    removes: matchesFromInitial.flatMap((matches, index) => matches.length === 0 ? [index] : []),
  };
}

export function createSlopTopPickerSession(
  service: WindowCapabilityService,
  transport: SlopTopPickerTransport,
  options: SlopTopPickerSessionOptions = {},
): WindowPickSession {
  const ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  const resultPollMs = options.resultPollMs ?? DEFAULT_RESULT_POLL_MS;
  let active = false;
  let token = '';
  let memberDescriptors: PersistedWindowMemberDescriptor[] = [];
  /** Members the picker was actually shown. Only these can be removed by their
   * absence from the final set; see the removal rule in consumeResult(). */
  let seededMemberIndices = new Set<number>();
  let onResult: ((result: WindowPickResult) => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resultInFlight = false;
  /** The periodic desktop scan is held off for the whole pick. It shares the one
   * control helper with the picker, and a commit that had to queue behind a scan
   * took twelve seconds to land - the creator pressed a key and watched nothing
   * happen. Released in finish(), whatever the outcome. */
  let lifecycleHold: (() => void) | null = null;

  function clearPoll(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    resultInFlight = false;
  }

  function finish(result: WindowPickResult): void {
    if (!active) return;
    const callback = onResult;
    const finishedToken = token;
    active = false;
    token = '';
    memberDescriptors = [];
    onResult = null;
    clearPoll();
    lifecycleHold?.();
    lifecycleHold = null;
    void Promise.resolve(transport.cleanup(finishedToken)).catch(() => undefined);
    callback?.(result);
  }

  async function consumeResult(): Promise<void> {
    if (!active || resultInFlight) return;
    resultInFlight = true;
    const expectedToken = token;
    try {
      const raw = await transport.readResult(expectedToken);
      const parsed = parseResult(raw, expectedToken);
      if (!parsed && raw !== null && raw !== undefined) {
        const seen = object(raw) && typeof raw['token'] === 'string' ? raw['token'] : 'none';
        notePickerOutcome('picker-fail', 'result read but not usable: token ' + (seen === expectedToken ? 'matched' : 'belonged to another session') + ', version ' + String(object(raw) ? raw['version'] : 'none'));
      }
      if (!active || token !== expectedToken || !parsed) {
        if (active && token === expectedToken && !parsed) notePickerOutcome('picker-fail', 'the picker result did not parse as protocol v3');
        return;
      }
      if (parsed.outcome === 'cancelled') {
        finish({ outcome: 'cancelled' });
        return;
      }
      // Only the genuinely new windows are bound: an unchanged member already
      // has its capability and icon in the project, and binding the whole final
      // set made every commit pay one helper round trip per member.
      const bound = await service.bindNativePickerSelection(parsed.windows, memberDescriptors);
      if (!active || token !== expectedToken) return;
      if (bound.outcome !== 'success') {
        notePickerOutcome('picker-fail', 'the final native picker set could not be resolved: ' + (bound.error ?? bound.outcome));
        finish({ outcome: 'failed', error: bound.error ?? 'the final native picker set could not be resolved' });
        return;
      }
      const diff = descriptorDiff(memberDescriptors, bound.windows);
      if (!diff) {
        notePickerOutcome('picker-fail', 'the final picker set has ambiguous window identities');
        finish({ outcome: 'failed', error: 'the final picker set has ambiguous window identities' });
        return;
      }
      // REMOVALS ARE POSITIVE INTENT, NOT ABSENCE.
      //
      // `deselectedSeedIds` names the seeded members the human actually toggled
      // off. Absence from the final green set is never a removal: a member the
      // picker never showed is absent without anyone asking, and reading that as
      // a removal deleted eight members the moment the creator picked one new
      // window. Every id must resolve to a member that was seeded, and must not
      // also be present in the final set - a contradictory result fails whole.
      const removes: Array<{ descriptor: PersistedWindowMemberDescriptor }> = [];
      for (const seedId of parsed.deselectedSeedIds) {
        if (!seededMemberIndices.has(seedId)) {
          notePickerOutcome('picker-fail', 'the picker reported a removal for a member it was never shown');
        finish({ outcome: 'failed', error: 'the picker reported a removal for a member it was never shown' });
          return;
        }
        const descriptor = memberDescriptors[seedId];
        if (!descriptor) {
          notePickerOutcome('picker-fail', 'the picker reported a removal for an unknown member');
        finish({ outcome: 'failed', error: 'the picker reported a removal for an unknown member' });
          return;
        }
        const stillSelected = bound.windows.some((window) =>
          compareWindowMemberIdentity(descriptor, window.descriptor) === 'same');
        if (stillSelected) {
          notePickerOutcome('picker-fail', 'the picker reported a member as both removed and selected');
        finish({ outcome: 'failed', error: 'the picker reported a member as both removed and selected' });
          return;
        }
        removes.push({ descriptor });
      }
      notePickerOutcome('picker-commit', 'adds ' + diff.adds.length + ', removes ' + removes.length);
      finish({
        outcome: 'committed',
        adds: diff.adds.map((index) => {
          const window = bound.windows[index]!;
          return { descriptor: window.descriptor, capability: window.capability, candidate: window.candidate };
        }),
        removes,
      });
    } catch (caught) {
      // A missing result file is the normal idle state. Any other local
      // transport/binding fault terminates visibly instead of leaving Enter
      // apparently ignored while the same broken result is polled forever.
      const code = object(caught) && typeof caught['code'] === 'string' ? caught['code'] : '';
      if (code !== 'ENOENT' && active && token === expectedToken) {
        const detail = caught instanceof Error ? caught.message : String(caught);
        console.error('[sloptop-picker] result consumption failed', caught);
        finish({ outcome: 'failed', error: `SlopTop picker commit failed: ${detail}` });
      }
    } finally {
      resultInFlight = false;
    }
  }

  async function awaitAck(expectedToken: string): Promise<boolean> {
    const deadline = Date.now() + ackTimeoutMs;
    while (active && token === expectedToken && Date.now() < deadline) {
      try {
        if (ackMatches(await transport.readAck(expectedToken), expectedToken)) return true;
      } catch {
        // The acknowledgement file does not exist until AHK accepts the mode.
      }
      await new Promise((resolve) => setTimeout(resolve, resultPollMs));
    }
    return false;
  }

  return {
    get active() { return active; },
    async begin(request) {
      if (active) return { outcome: 'failed', error: 'another native picker session is already active' };
      const prepared = await service.prepareNativePicker(request.memberDescriptors);
      if (prepared.outcome === 'success') notePickerOutcome('picker-open', 'seeded ' + prepared.seeds.length + ' of ' + request.memberDescriptors.length + ' members');
      else notePickerOutcome('picker-fail', 'the picker could not be prepared: ' + String(prepared.error ?? prepared.outcome));
      if (prepared.outcome !== 'success') {
        return { outcome: 'failed', error: prepared.error ?? 'current layout members could not be prepared for native picking' };
      }
      active = true;
      token = randomUUID();
      memberDescriptors = [...request.memberDescriptors];
      seededMemberIndices = new Set(prepared.seededIndices);
      onResult = request.onResult;
      // Hold the periodic scan off for the whole pick: the picker's own list
      // calls share that one helper, and a commit queued behind a scan took
      // twelve seconds to reach the creator.
      try {
        lifecycleHold = service.holdWindowLifecycleRefresh?.().release ?? null;
      } catch {
        lifecycleHold = null;
      }
      const beginToken = token;
      try {
        await transport.activate({ version: 3, token: beginToken, seeds: prepared.seeds });
        pollTimer = setInterval(() => { void consumeResult(); }, resultPollMs);
        if (!(await awaitAck(beginToken))) {
          notePickerOutcome('picker-fail', 'the picker never acknowledged the activation');
          finish({ outcome: 'failed', error: 'SlopTop did not acknowledge the picker activation.' });
          return { outcome: 'failed', error: 'SlopTop did not acknowledge the picker activation.' };
        }
        return { outcome: 'started' };
      } catch {
        finish({ outcome: 'failed', error: 'SlopTop picker activation failed.' });
        return { outcome: 'failed', error: 'SlopTop picker activation failed.' };
      }
    },
    // Pointer staging and Enter commit are owned entirely by AHK. These
    // compatibility methods intentionally do not create a second authority.
    stage() {},
    async commit() {},
    async cancel() {
      if (!active) return;
      const cancelToken = token;
      try { await transport.requestCancel(cancelToken); } catch { /* local cleanup still wins */ }
      finish({ outcome: 'cancelled' });
    },
  };
}
