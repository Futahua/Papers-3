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
import type { WindowPickResult, WindowPickSession } from './windowPickSession';

export const SLOPTOP_PICKER_PROTOCOL_VERSION = 2;
const DEFAULT_ACK_TIMEOUT_MS = 3000;
const DEFAULT_RESULT_POLL_MS = 25;
const MAX_NATIVE_WINDOWS = 64;
const COORDINATE_LIMIT = 65536;

export interface SlopTopPickerActivation {
  version: 2;
  token: string;
  seeds: NativePickerWindowIdentity[];
}

interface SlopTopPickerCommittedResult {
  version: 2;
  token: string;
  outcome: 'committed';
  windows: NativePickerWindowIdentity[];
}

interface SlopTopPickerCancelledResult {
  version: 2;
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
      ? { version: 2, token, outcome: 'cancelled' }
      : null;
  }
  if (value['outcome'] !== 'committed' || !exactKeys(value, ['version', 'token', 'outcome', 'windows'])) return null;
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
  return { version: 2, token, outcome: 'committed', windows };
}

function ackMatches(value: unknown, token: string): boolean {
  return object(value)
    && exactKeys(value, ['version', 'token', 'active'])
    && value['version'] === SLOPTOP_PICKER_PROTOCOL_VERSION
    && value['token'] === token
    && value['active'] === true;
}

function descriptorKey(descriptor: PersistedWindowMemberDescriptor): string {
  return `${descriptor.executableFingerprint ?? ''}|${descriptor.title}`;
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
  let onResult: ((result: WindowPickResult) => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resultInFlight = false;

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
    void Promise.resolve(transport.cleanup(finishedToken)).catch(() => undefined);
    callback?.(result);
  }

  async function consumeResult(): Promise<void> {
    if (!active || resultInFlight) return;
    resultInFlight = true;
    const expectedToken = token;
    try {
      const parsed = parseResult(await transport.readResult(expectedToken), expectedToken);
      if (!active || token !== expectedToken || !parsed) return;
      if (parsed.outcome === 'cancelled') {
        finish({ outcome: 'cancelled' });
        return;
      }
      const bound = await service.bindNativePickerSelection(parsed.windows);
      if (!active || token !== expectedToken) return;
      if (bound.outcome !== 'success') {
        finish({ outcome: 'failed', error: bound.error ?? 'the final native picker set could not be resolved' });
        return;
      }
      const initial = new Map(memberDescriptors.map((descriptor) => [descriptorKey(descriptor), descriptor]));
      const final = new Map(bound.windows.map((window) => [descriptorKey(window.descriptor), window]));
      finish({
        outcome: 'committed',
        adds: [...final.entries()]
          .filter(([key]) => !initial.has(key))
          .map(([, window]) => ({ descriptor: window.descriptor, capability: window.capability, candidate: window.candidate })),
        removes: [...initial.entries()]
          .filter(([key]) => !final.has(key))
          .map(([, descriptor]) => ({ descriptor })),
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
      if (prepared.outcome !== 'success') {
        return { outcome: 'failed', error: prepared.error ?? 'current layout members could not be prepared for native picking' };
      }
      active = true;
      token = randomUUID();
      memberDescriptors = [...request.memberDescriptors];
      onResult = request.onResult;
      const beginToken = token;
      try {
        await transport.activate({ version: 2, token: beginToken, seeds: prepared.seeds });
        pollTimer = setInterval(() => { void consumeResult(); }, resultPollMs);
        if (!(await awaitAck(beginToken))) {
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
