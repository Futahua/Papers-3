import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { ProcessInstanceIdentity } from '../../src/main/visual/processIdentity';
import { createVisualArtifactStore } from '../../src/main/visual/visualArtifactStore';
import { captureVisualSurface } from '../../src/main/visual/visualCaptureService';
import type { VisualSurfaceObservationState } from '../../src/main/visual/visualSurfaceObservationState';

const target = { windowId: 7, surfaceId: 'surface-a' };
const processIdentity: ProcessInstanceIdentity = {
  pid: 1234,
  appInstanceId: '11111111-1111-4111-8111-111111111111',
  startedAt: '2026-09-02T00:00:00.000Z',
  build: { version: '1.3.11', commit: 'test', packaged: false },
  executableIdentity: { status: 'unavailable' },
};

function observation(): VisualSurfaceObservationState {
  return {
    windowId: target.windowId,
    surfaceId: target.surfaceId,
    senderId: 42,
    senderGeneration: 1,
    renderCycleId: '22222222-2222-4222-8222-222222222222',
    documentStateRevision: 'revision-1',
    domReady: true,
    hydrated: true,
    firstPaint: true,
    layoutEpoch: 3,
    layoutStable: true,
    renderFailed: false,
    semanticKeys: ['canvas.root'],
  };
}

async function createDependencies(root: string, topologyRevision: () => number, capturePage: () => Promise<Uint8Array>) {
  return {
    processIdentity: () => processIdentity,
    topologyRevision,
    surface: () => ({ projectId: 'project-a', presentation: 'visible' as const }),
    runtime: () => ({ senderId: 42, capturePage, requestFence: async () => true }),
    observation: () => observation(),
    artifacts: createVisualArtifactStore(root),
  };
}

describe('synchronized visual surface capture', () => {
  it('captures exact pixels and stores correlated artifact metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-capture-'));
    const capturePage = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
    const result = await captureVisualSurface(await createDependencies(root, () => 4, capturePage), target);

    expect(result.consistency).toEqual({ status: 'stable' });
    expect(result.captureId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.png).toMatchObject({ mimeType: 'image/png', size: 4 });
    expect(result.revisions).toEqual({
      workspaceTopologyRevision: 4,
      documentStateRevision: 'revision-1',
      renderCycleId: '22222222-2222-4222-8222-222222222222',
      layoutEpoch: 3,
    });
    expect(result.summary.semanticKeys).toEqual(['canvas.root']);
    expect(capturePage).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once after a fence change and then accepts stability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-capture-'));
    let topology = 4;
    let captures = 0;
    const capturePage = vi.fn(async () => {
      captures += 1;
      if (captures === 1) topology = 5;
      return new Uint8Array([1, 2, 3]);
    });
    const result = await captureVisualSurface(await createDependencies(root, () => topology, capturePage), target);

    expect(result.consistency).toEqual({ status: 'stable' });
    expect(capturePage).toHaveBeenCalledTimes(2);
    expect(result.png?.size).toBe(3);
  });

  it('returns bounded instability without finalizing an artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-capture-'));
    let topology = 4;
    const capturePage = vi.fn(async () => {
      topology += 1;
      return new Uint8Array([1]);
    });
    const result = await captureVisualSurface(await createDependencies(root, () => topology, capturePage), target);

    expect(result.consistency).toEqual({ status: 'unstable', reason: 'topology-changed' });
    expect(result.png).toBeUndefined();
    expect(capturePage).toHaveBeenCalledTimes(2);
  });
});
