import { describe, expect, it } from 'vitest';

import { createProcessInstanceIdentity, currentProcessInstanceSeed, processStartTime } from '../../src/main/visual/processIdentity';
import { assessVisualConsistency, type VisualObservationFence } from '../../src/main/visual/visualObservation';

const build = { version: '1.3.11', commit: 'abc1234', packaged: true } as const;

function fence(overrides: Partial<VisualObservationFence> = {}): VisualObservationFence {
  return {
    target: { windowId: 4, surfaceId: 'surface-a' },
    process: {
      pid: 321,
      appInstanceId: 'instance-a',
      startedAt: '2026-09-02T00:00:00.000Z',
      build,
      executableIdentity: { status: 'available', canonicalFileId: 'dev:7:ino:99' },
    },
    topologyRevision: 8,
    documentStateRevision: 'doc-4',
    renderCycleId: 'render-2',
    layoutEpoch: 12,
    senderBinding: 'binding-a',
    documentInstanceId: '33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

describe('visual observation fences', () => {
  it('accepts a coherent unchanged fence', () => {
    expect(assessVisualConsistency(fence(), fence())).toEqual({ status: 'stable' });
  });

  it.each([
    ['topology', { topologyRevision: 9 }, 'topology-changed'],
    ['document state', { documentStateRevision: 'doc-5' }, 'state-changed'],
    ['render cycle', { renderCycleId: 'render-3' }, 'state-changed'],
    ['layout', { layoutEpoch: 13 }, 'layout-changed'],
    ['renderer binding', { senderBinding: 'binding-b' }, 'renderer-replaced'],
  ] as const)('refuses a changed %s fence', (_label, change, reason) => {
    expect(assessVisualConsistency(fence(), fence(change))).toEqual({ status: 'unstable', reason });
  });

  it('treats a fresh process as renderer replacement even if topology is unchanged', () => {
    expect(assessVisualConsistency(
      fence(),
      fence({ process: { ...fence().process, appInstanceId: 'instance-b' } }),
    )).toEqual({ status: 'unstable', reason: 'renderer-replaced' });
  });
});
describe('process instance identity', () => {
  it('uses file identity rather than the spelling of an executable alias', async () => {
    const identities = await Promise.all([
      createProcessInstanceIdentity({
        pid: 101, executablePath: 'C:\\alias\\Papers.exe', build,
        appInstanceId: 'instance-a', startedAt: '2026-09-02T00:00:00.000Z',
        realpath: async () => 'C:\\real\\Papers.exe',
        stat: async () => ({ dev: 7n, ino: 99n }),
      }),
      createProcessInstanceIdentity({
        pid: 102, executablePath: 'C:\\real\\Papers.exe', build,
        appInstanceId: 'instance-b', startedAt: '2026-09-02T00:01:00.000Z',
        realpath: async () => 'C:\\real\\Papers.exe',
        stat: async () => ({ dev: 7n, ino: 99n }),
      }),
    ]);

    expect(identities[0]!.executableIdentity).toEqual(identities[1]!.executableIdentity);
    expect(identities[0]!.pid).not.toBe(identities[1]!.pid);
    expect(identities[0]!.appInstanceId).not.toBe(identities[1]!.appInstanceId);
    expect(identities[0]!.startedAt).not.toBe(identities[1]!.startedAt);
  });

  it('reports unavailable file identity rather than falling back to a path string', async () => {
    await expect(createProcessInstanceIdentity({
      pid: 101, executablePath: 'C:\\Papers.exe', build,
      realpath: async (path) => path,
      stat: async () => ({ dev: 0n, ino: 0n }),
    })).resolves.toMatchObject({ executableIdentity: { status: 'unavailable' } });
  });

  it('does not treat an inode without a volume identity as canonical', async () => {
    await expect(createProcessInstanceIdentity({
      pid: 101, executablePath: 'C:\\Papers.exe', build,
      realpath: async (path) => path,
      stat: async () => ({ dev: 0n, ino: 99n }),
    })).resolves.toMatchObject({ executableIdentity: { status: 'unavailable' } });
  });

  it('survives realpath and stat failures without blocking diagnostics', async () => {
    await expect(createProcessInstanceIdentity({
      pid: 101, executablePath: 'C:\\Papers.exe', build,
      realpath: async () => { throw new Error('junction unavailable'); },
    })).resolves.toMatchObject({ executableIdentity: { status: 'unavailable' } });
    await expect(createProcessInstanceIdentity({
      pid: 101, executablePath: 'C:\\Papers.exe', build,
      realpath: async (path) => path,
      stat: async () => { throw new Error('stat unavailable'); },
    })).resolves.toMatchObject({ executableIdentity: { status: 'unavailable' } });
  });

  it('serializes a file id above 2^53 without Number precision loss', async () => {
    await expect(createProcessInstanceIdentity({
      pid: 101, executablePath: 'C:\\Papers.exe', build,
      realpath: async (path) => path,
      stat: async () => ({ dev: 17n, ino: 9007199254740993n }),
    })).resolves.toMatchObject({
      executableIdentity: { status: 'available', canonicalFileId: 'dev:17:ino:9007199254740993' },
    });
  });

  it('keeps process start identity stable when diagnostics initialize later', () => {
    const seed = currentProcessInstanceSeed();
    expect(seed).toEqual(currentProcessInstanceSeed());
    expect(processStartTime(
      () => new Date('2026-09-02T01:00:00.000Z'),
      () => 120,
    )).toBe('2026-09-02T00:58:00.000Z');
  });
});
