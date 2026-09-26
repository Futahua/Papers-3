import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHoverInputBridge, type HoverInputBridgeOptions } from '../../src/main/windows/hoverInputBridge';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(onCaptured: HoverInputBridgeOptions['onCaptured'] = vi.fn()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-hover-policy-'));
  roots.push(root);
  const sourcePath = path.join(root, 'helper.cs');
  const cacheDirectory = path.join(root, 'cache');
  const executable = path.join(cacheDirectory, 'papers-hover-input-bridge.exe');
  const source = Buffer.from('test native helper source');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(sourcePath, source);
  fs.writeFileSync(executable, 'test executable');
  fs.writeFileSync(`${executable}.sha256`, crypto.createHash('sha256').update(source).digest('hex'));

  const stdin = { destroyed: false, write: vi.fn((_record: string) => true) };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr });
  const spawn = vi.fn(() => child);
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const options: HoverInputBridgeOptions = {
    cacheDirectory,
    sourcePath,
    spawn: spawn as unknown as HoverInputBridgeOptions['spawn'],
    onAltQ: vi.fn(),
    onCaptured,
  };
  const bridge = createHoverInputBridge(options);
  if (!bridge) throw new Error('expected a Windows helper bridge');
  return { bridge, child, stdin };
}

describe('hover input policy helper acknowledgement', () => {
  it('releases a failed captured key and resets the native handoff for a later try', async () => {
    const { bridge, child, stdin } = harness(async () => { throw new Error('launcher unavailable'); });
    child.stdout.write('CAPTURE\t7\t41\tQQ==\n');
    await vi.waitFor(() => {
      expect(stdin.write.mock.calls.map(([record]) => record)).toContain('ACK\t41\n');
      expect(stdin.write.mock.calls.map(([record]) => record)).toContain('OVERLAY\t0\n');
    });
    bridge.close();
    child.emit('exit', 0);
  });

  it('resolves only when the matching request ID receives a positive helper acknowledgement', async () => {
    const { bridge, child, stdin } = harness();
    const policy = bridge.setPolicy(7, true, ['A', 'Shift+B']);
    const record = stdin.write.mock.calls[0]?.[0];
    expect(record).toMatch(/^POLICY\t\d+\t7\t1\t/);
    const requestId = String(record).split('\t')[1];
    let settled = false;
    void policy.then(() => { settled = true; });
    child.stdout.write(`POLICY_ACK\t999\tOK\t-\n`);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.stdout.write(`POLICY_ACK\t${requestId}\tOK\t-\n`);
    await expect(policy).resolves.toBeUndefined();
    bridge.close();
    child.emit('exit', 0);
  });

  it('keeps an in-flight overlay generation valid while a policy acknowledgement is pending', async () => {
    const { bridge, child, stdin } = harness();
    const overlay = bridge.setOverlayOpen(true);
    const overlayRecord = String(stdin.write.mock.calls[0]?.[0]);
    expect(overlayRecord).toMatch(/^OVERLAY\t1\t\d+\n$/);
    const generation = overlayRecord.trimEnd().split('\t')[2];

    const policy = bridge.setPolicy(7, true, ['A']);
    const policyRecord = String(stdin.write.mock.calls[1]?.[0]);
    const requestId = policyRecord.split('\t')[1];
    const overlayAssertion = expect(overlay).resolves.toBeUndefined();
    const policyAssertion = expect(policy).resolves.toBeUndefined();

    child.stdout.write(`POLICY_ACK\t${requestId}\tOK\t-\n`);
    child.stdout.write(`OVERLAY_READY\t${generation}\n`);
    await Promise.all([overlayAssertion, policyAssertion]);
    bridge.close();
    child.emit('exit', 0);
  });

  it('correlates several pending policy changes when the helper acknowledges out of order', async () => {
    const { bridge, child, stdin } = harness();
    const pending = [
      bridge.setPolicy(7, true, ['A']),
      bridge.setPolicy(7, false, []),
      bridge.setPolicy(7, true, ['Shift+C']),
    ];
    const records = stdin.write.mock.calls.map(([record]) => String(record).trimEnd().split('\t'));
    const ids = records.map((record) => record[1]);
    expect(new Set(ids).size).toBe(3);
    expect(records.map((record) => record.slice(2, 4))).toEqual([
      ['7', '1'], ['7', '0'], ['7', '1'],
    ]);
    const assertions = pending.map((promise) => expect(promise).resolves.toBeUndefined());
    child.stdout.write(`POLICY_ACK\t${ids[2]}\tOK\t-\n`);
    child.stdout.write(`POLICY_ACK\t${ids[0]}\tOK\t-\n`);
    child.stdout.write(`POLICY_ACK\t${ids[1]}\tOK\t-\n`);
    await Promise.all(assertions);
    bridge.close();
    child.emit('exit', 0);
  });

  it('rejects pending policy changes promptly when the helper exits before acknowledgement', async () => {
    const { bridge, child, stdin } = harness();
    const first = bridge.setPolicy(7, true, ['A']);
    const acknowledged = bridge.setPolicy(7, false, ['B']);
    const third = bridge.setPolicy(7, true, ['C']);
    const ids = stdin.write.mock.calls.map(([record]) => String(record).split('\t')[1]);
    const firstAssertion = expect(first).rejects.toThrow(/helper disconnected/);
    const acknowledgedAssertion = expect(acknowledged).resolves.toBeUndefined();
    const thirdAssertion = expect(third).rejects.toThrow(/helper disconnected/);
    child.stdout.write(`POLICY_ACK\t${ids[1]}\tOK\t-\n`);
    child.emit('exit', 17);
    await Promise.all([firstAssertion, acknowledgedAssertion, thirdAssertion]);
    // A late ACK after exit is stale and cannot revive a rejected renewal.
    child.stdout.write(`POLICY_ACK\t${ids[2]}\tOK\t-\n`);
    await expect(bridge.setPolicy(7, false, ['D'])).rejects.toThrow(/helper is closed/);
  });

  it('returns a clear rejection for helper error acknowledgements and missing acknowledgements time out', async () => {
    const { bridge, child, stdin } = harness();
    const rejected = bridge.setPolicy(7, false, []);
    const firstId = String(stdin.write.mock.calls[0]?.[0]).split('\t')[1];
    child.stdout.write(`POLICY_ACK\t${firstId}\tERROR\twidget-not-found\n`);
    await expect(rejected).rejects.toThrow(/widget-not-found/);

    vi.useFakeTimers();
    const timedOut = bridge.setPolicy(7, true, ['A']);
    const latest = bridge.setPolicy(7, false, ['Shift+B']);
    const secondId = String(stdin.write.mock.calls[1]?.[0]).split('\t')[1];
    const latestId = String(stdin.write.mock.calls[2]?.[0]).split('\t')[1];
    expect(secondId).not.toBe(firstId);
    expect(latestId).not.toBe(secondId);
    const timedOutAssertion = expect(timedOut).rejects.toThrow(/did not acknowledge/);
    const latestAssertion = expect(latest).resolves.toBeUndefined();
    // Renewals target the same widget. The latest ACK may arrive first; the
    // earlier request still times out independently and cannot settle it.
    child.stdout.write(`POLICY_ACK\t${latestId}\tOK\t-\n`);
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all([timedOutAssertion, latestAssertion]);
    child.stdout.write(`POLICY_ACK\t${secondId}\tOK\t-\n`);
    bridge.close();
    child.emit('exit', 0);
  });
});
