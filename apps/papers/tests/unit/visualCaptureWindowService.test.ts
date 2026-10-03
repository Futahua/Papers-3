import { describe, expect, it, vi } from 'vitest';

import { captureVisualWindow, type VisualWindowCaptureDependencies } from '../../src/main/visual/visualCaptureWindowService';
import type { VisualArtifactMetadata, VisualArtifactStore } from '../../src/main/visual/visualArtifactStore';
import type { VisualSurfaceObservationState } from '../../src/main/visual/visualSurfaceObservationState';

const processIdentity = {
  pid: 10,
  appInstanceId: 'instance-a',
  startedAt: '2026-09-02T00:00:00.000Z',
  build: { version: '1.3.11', commit: 'abc1234', packaged: false },
  executableIdentity: { status: 'available' as const, canonicalFileId: 'dev:file-a' },
};

const metadata: VisualArtifactMetadata = {
  artifactId: 'va-11111111-1111-4111-8111-111111111111',
  mimeType: 'image/png', size: 8, sha256: 'a'.repeat(64),
  createdAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z',
};

function makeDeps(mutateAfterCapture?: (state: { surfaces: Array<{ observation: VisualSurfaceObservationState | null }> }) => void): VisualWindowCaptureDependencies {
  const state = {
    topology: 4,
    window: { windowId: 7, sourceId: 'window:7:1', visible: true, nativeBounds: { x: 10, y: 20, width: 900, height: 600 }, hostContents: { id: 77, isDestroyed: () => false } as never },
    surfaces: [{
      surfaceId: 'surface-a', projectId: 'project-a', presentation: 'visible' as const,
      observation: {
        windowId: 7, surfaceId: 'surface-a', senderId: 88, senderGeneration: 2,
        documentInstanceId: '11111111-1111-4111-8111-111111111111', navigationCount: 1,
        renderCycleId: '22222222-2222-4222-8222-222222222222', documentStateRevision: 'rev-1',
        domReady: true, hydrated: true, firstPaint: true, layoutEpoch: 3, layoutStable: true,
        renderFailed: false, semanticKeys: ['canvas.root'],
      },
    }],
  };
  const artifacts: VisualArtifactStore = {
    put: vi.fn(async () => metadata),
    read: vi.fn(), delete: vi.fn(async () => true), cleanup: vi.fn(async () => undefined),
  };
  let captureCount = 0;
  return {
    processIdentity: () => processIdentity,
    window: () => ({ ...state.window, nativeBounds: { ...state.window.nativeBounds } }),
    topologyRevision: () => state.topology,
    visibleSurfaces: () => state.surfaces.map((surface) => ({ ...surface, observation: surface.observation && { ...surface.observation } })),
    requestCapture: vi.fn(async () => {
      captureCount += 1;
      mutateAfterCapture?.(state);
      return { bytes: new Uint8Array([137, 80, 78, 71]), width: 1800, height: 1200, sourceId: 'window:7:1' };
    }),
    artifacts,
  };
}

describe('composed visual window capture', () => {
  it('captures the exact native source with actual pixel dimensions and surface revisions', async () => {
    const deps = makeDeps();
    const result = await captureVisualWindow(deps, { windowId: 7 });
    expect(result.consistency).toEqual({ status: 'stable' });
    expect(result.pixelSize).toEqual({ width: 1800, height: 1200 });
    expect(result.nativeBounds).toEqual({ x: 10, y: 20, width: 900, height: 600 });
    expect(result.surfaces).toEqual([expect.objectContaining({
      surfaceId: 'surface-a', projectId: 'project-a', presentation: 'visible',
      revisions: { documentStateRevision: 'rev-1', renderCycleId: '22222222-2222-4222-8222-222222222222', layoutEpoch: 3 },
    })]);
    expect(result.png).toEqual(metadata);
  });

  it('settles cancellation while native capture is held and never publishes pixels', async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    let releaseCapture!: (value: { bytes: Uint8Array; width: number; height: number; sourceId: string } | null) => void;
    const held = new Promise<{ bytes: Uint8Array; width: number; height: number; sourceId: string } | null>((resolve) => { releaseCapture = resolve; });
    deps.requestCapture = vi.fn(() => held);

    const capture = captureVisualWindow(deps, { windowId: 7 }, undefined, controller.signal);
    await vi.waitFor(() => expect(deps.requestCapture).toHaveBeenCalledOnce());
    controller.abort();
    await expect(capture).rejects.toThrow('Visual operation was cancelled.');
    expect(deps.artifacts.put).not.toHaveBeenCalled();
    releaseCapture(null);
  });

  it('retries once after a member state change and returns bounded instability', async () => {
    let revision = 1;
    const deps = makeDeps((state) => {
      revision += 1;
      state.surfaces[0]!.observation!.documentStateRevision = `rev-${revision}`;
    });
    const result = await captureVisualWindow(deps, { windowId: 7 });
    expect(result.consistency).toEqual({ status: 'unstable', reason: 'state-changed' });
    expect(deps.requestCapture).toHaveBeenCalledTimes(2);
    expect(deps.artifacts.put).not.toHaveBeenCalled();
  });

  it('classifies same-renderer navigation as state change, not renderer replacement', async () => {
    let navigation = 0;
    const deps = makeDeps((state) => {
      navigation += 1;
      state.surfaces[0]!.observation!.documentInstanceId = `${navigation}3333333-3333-4333-8333-333333333333`;
      state.surfaces[0]!.observation!.renderCycleId = `${navigation}4444444-4444-4444-8444-444444444444`;
    });
    const result = await captureVisualWindow(deps, { windowId: 7 });
    expect(result.consistency).toEqual({ status: 'unstable', reason: 'state-changed' });
    expect(deps.requestCapture).toHaveBeenCalledTimes(2);
    expect(deps.artifacts.put).not.toHaveBeenCalled();
  });

  it('rejects a native image returned for a foreign source', async () => {
    const deps = makeDeps();
    deps.requestCapture = vi.fn(async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]), width: 1800, height: 1200, sourceId: 'window:foreign:1',
    }));
    await expect(captureVisualWindow(deps, { windowId: 7 })).rejects.toThrow('native capture source changed');
    expect(deps.requestCapture).toHaveBeenCalledTimes(2);
    expect(deps.artifacts.put).not.toHaveBeenCalled();
  });
});
