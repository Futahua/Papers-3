import { describe, expect, it } from 'vitest';

import { createProcessInstanceIdentity } from '../../src/main/visual/processIdentity';
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
      executableIdentity: { canonicalFileId: 'dev:7:ino:99' },
    },
    topologyRevision: 8,
    documentStateRevision: 'doc-4',
    renderCycleId: 'render-2',
    layoutEpoch: 12,
    senderBinding: 'binding-a',
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
        stat: async () => ({ dev: 7, ino: 99 }),
      }),
      createProcessInstanceIdentity({
        pid: 102, executablePath: 'C:\\real\\Papers.exe', build,
        appInstanceId: 'instance-b', startedAt: '2026-09-02T00:01:00.000Z',
        realpath: async () => 'C:\\real\\Papers.exe',
        stat: async () => ({ dev: 7, ino: 99 }),
      }),
    ]);

    expect(identities[0]!.executableIdentity).toEqual(identities[1]!.executableIdentity);
    expect(identities[0]!.pid).not.toBe(identities[1]!.pid);
    expect(identities[0]!.appInstanceId).not.toBe(identities[1]!.appInstanceId);
    expect(identities[0]!.startedAt).not.toBe(identities[1]!.startedAt);
  });

  it('refuses an unavailable file identity rather than falling back to a path string', async () => {
    await expect(createProcessInstanceIdentity({
      pid: 101, executablePath: 'C:\\Papers.exe', build,
      realpath: async (path) => path,
      stat: async () => ({ dev: 0, ino: 0 }),
    })).rejects.toThrow(/file identity is unavailable/);
  });
});
