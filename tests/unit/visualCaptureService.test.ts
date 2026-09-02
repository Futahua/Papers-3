import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { ProcessInstanceIdentity } from '../../src/main/visual/processIdentity';
import { createVisualArtifactStore } from '../../src/main/visual/visualArtifactStore';
import { captureVisualSurface } from '../../src/main/visual/visualCaptureService';
import type { VisualSurfaceObservationState } from '../../src/main/visual/visualSurfaceObservationState';
import type { VisualCaptureRuntime } from '../../src/main/visual/visualCaptureService';

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
    documentInstanceId: '33333333-3333-4333-8333-333333333333',
    navigationCount: 1,
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

  it.each([
    ['document revision', { documentStateRevision: 'revision-2' }, 'state-changed'],
    ['render cycle', { renderCycleId: '44444444-4444-4444-8444-444444444444' }, 'state-changed'],
    ['layout epoch', { layoutEpoch: 4 }, 'layout-changed'],
  ] as const)('retries after a %s changes during pixel capture', async (_label, change, reason) => {
    const root = await mkdtemp(join(tmpdir(), 'papers-capture-'));
    let state = observation();
    let captures = 0;
    const capturePage = vi.fn(async () => {
      captures += 1;
      if (captures === 1) state = { ...state, ...change, semanticKeys: [...state.semanticKeys] };
      return new Uint8Array([1, 2, 3]);
    });
    const runtime: VisualCaptureRuntime = { senderId: 42, capturePage, requestFence: async () => true };
    const result = await captureVisualSurface({
      processIdentity: () => processIdentity,
      topologyRevision: () => 4,
      surface: () => ({ projectId: 'project-a', presentation: 'visible' }),
      runtime: () => runtime,
      observation: () => ({ ...state, semanticKeys: [...state.semanticKeys] }),
      artifacts: createVisualArtifactStore(root),
    }, target);
    expect(result.consistency).toEqual({ status: 'stable' });
    expect(captures).toBe(2);
    expect(result.revisions.documentStateRevision).toBe(state.documentStateRevision);
    if (reason === 'layout-changed') expect(result.revisions.layoutEpoch).toBe(4);
  });

  it('retries renderer replacement during capture and returns bounded instability after two replacements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-capture-'));
    const firstState = observation();
    const secondState = { ...firstState, senderId: 99, senderGeneration: 2, documentInstanceId: '55555555-5555-4555-8555-555555555555' };
    let state = firstState;
    let current: VisualCaptureRuntime;
    const replacement = { senderId: 99, capturePage: vi.fn(async () => new Uint8Array([4, 5])), requestFence: async () => true };
    const first = { senderId: 42, capturePage: vi.fn(async () => { state = secondState; current = replacement; throw new Error('renderer gone'); }), requestFence: async () => true };
    current = first;
    const result = await captureVisualSurface({
      processIdentity: () => processIdentity,
      topologyRevision: () => 4,
      surface: () => ({ projectId: 'project-a', presentation: 'visible' }),
      runtime: () => current,
      observation: () => ({ ...state, semanticKeys: [...state.semanticKeys] }),
      artifacts: createVisualArtifactStore(root),
    }, target);
    expect(result.consistency).toEqual({ status: 'stable' });
    expect(first.capturePage).toHaveBeenCalledOnce();
    expect(replacement.capturePage).toHaveBeenCalledOnce();

    let replacements = 0;
    state = firstState;
    const thirdState = { ...firstState, senderId: 100, senderGeneration: 3, documentInstanceId: '66666666-6666-4666-8666-666666666666' };
    const third = { senderId: 100, capturePage: async () => new Uint8Array([6]), requestFence: async () => true };
    const second = { senderId: 99, capturePage: async () => { replacements += 1; state = thirdState; current = third; throw new Error('renderer gone'); }, requestFence: async () => true };
    current = { senderId: 42, capturePage: async () => { replacements += 1; state = secondState; current = second; throw new Error('renderer gone'); }, requestFence: async () => true };
    const unstable = await captureVisualSurface({
      processIdentity: () => processIdentity,
      topologyRevision: () => 4,
      surface: () => ({ projectId: 'project-a', presentation: 'visible' }),
      runtime: () => current,
      observation: () => ({ ...state, semanticKeys: [...state.semanticKeys] }),
      artifacts: createVisualArtifactStore(await mkdtemp(join(tmpdir(), 'papers-capture-'))),
    }, target);
    expect(unstable.consistency).toEqual({ status: 'unstable', reason: 'renderer-replaced' });
    expect(unstable.png).toBeUndefined();
    expect(replacements).toBe(2);
  });

  it('deletes a finalized artifact and retries when observation changes during artifact hashing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-capture-'));
    let state = observation();
    const base = createVisualArtifactStore(root);
    const artifacts = {
      ...base,
      put: async (bytes: Uint8Array, mimeType: string) => {
        const metadata = await base.put(bytes, mimeType);
        state = { ...state, documentStateRevision: 'revision-after-write', semanticKeys: [...state.semanticKeys] };
        return metadata;
      },
    };
    const capturePage = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const result = await captureVisualSurface({
      processIdentity: () => processIdentity,
      topologyRevision: () => 4,
      surface: () => ({ projectId: 'project-a', presentation: 'visible' }),
      runtime: () => ({ senderId: 42, capturePage, requestFence: async () => true }),
      observation: () => ({ ...state, semanticKeys: [...state.semanticKeys] }),
      artifacts,
    }, target);
    expect(result.consistency).toEqual({ status: 'stable' });
    expect(capturePage).toHaveBeenCalledTimes(2);
    expect(result.revisions.documentStateRevision).toBe('revision-after-write');
  });
});
