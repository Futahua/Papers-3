import { describe, expect, it, vi } from 'vitest';

import {
  controlRequestSchema,
  dispatchPapersControl,
  PAPERS_CONTROL_PROTOCOL_VERSION,
  papersControlEventFrameSchema,
  type PapersControlMethod,
} from '../../src/main/control/papersControlProtocol';
import { createPapersControlConfirmationBroker } from '../../src/main/control/papersControlConfirmation';
import { createWorkspaceTopology, openWorkspaceSurface, splitWorkspaceGroup } from '../../src/shared/workspaceTopology';

function request(method: PapersControlMethod, params: unknown = {}) {
  return controlRequestSchema.parse({
    id: 'r1',
    token: 'secret',
    protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
    method,
    params,
  });
}

describe('Papers developer control protocol', () => {
  it('requires an exact one-time confirmation before archive or deletion', async () => {
    const backpack = { id: 'bp-a', name: 'Alpha', archived: false };
    const archiveBackpack = vi.fn(async () => { backpack.archived = true; });
    const removeBackpack = vi.fn(async () => undefined);
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: async () => ({ windowId: 1 }), backpack: () => ({ ...backpack }),
      archiveBackpack, removeBackpack,
    };
    const confirmations = createPapersControlConfirmationBroker({
      now: () => 1_000,
      createId: () => backpack.archived
        ? '22222222-2222-4222-8222-222222222222'
        : '11111111-1111-4111-8111-111111111111',
    });
    const context = { connectionId: 'connection-a', confirmations };

    const archive = await dispatchPapersControl(
      dependencies,
      request('backpack.archive.prepare', { projectId: backpack.id }),
      context,
    ) as { challengeId: string; confirmationText: string };
    await expect(dispatchPapersControl(dependencies, request('confirmation.execute', {
      challengeId: archive.challengeId, confirmationText: archive.confirmationText,
    }), context)).resolves.toEqual({ action: 'backpack.archive', projectId: 'bp-a', name: 'Alpha' });
    expect(archiveBackpack).toHaveBeenCalledWith('bp-a', 'Alpha');

    const removal = await dispatchPapersControl(
      dependencies,
      request('backpack.remove.prepare', { projectId: backpack.id }),
      context,
    ) as { challengeId: string; confirmationText: string };
    backpack.name = 'Renamed';
    await expect(dispatchPapersControl(dependencies, request('confirmation.execute', {
      challengeId: removal.challengeId, confirmationText: removal.confirmationText,
    }), context)).rejects.toThrow(/changed/);
    expect(removeBackpack).not.toHaveBeenCalled();
    await expect(dispatchPapersControl(dependencies, request('confirmation.execute', {
      challengeId: removal.challengeId, confirmationText: removal.confirmationText,
    }), context)).rejects.toThrow(/missing or expired/);
  });

  it('refuses destructive preparation without live state and connection context', async () => {
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: async () => ({ windowId: 1 }), backpack: () => null,
    };
    await expect(dispatchPapersControl(dependencies, request('backpack.archive.prepare', { projectId: 'bp-a' })))
      .rejects.toThrow(/authenticated control connection/);

    const context = { connectionId: 'connection-a', confirmations: createPapersControlConfirmationBroker() };
    await expect(dispatchPapersControl(dependencies, request('backpack.archive.prepare', { projectId: 'bp-a' }), context))
      .rejects.toThrow(/not available/);
  });

  it('dispatches only the small semantic command catalog', async () => {
    // Results must satisfy the catalog's declared output shape: the boundary
    // validates what it is about to disclose rather than trusting whatever a
    // dependency returns.
    const window = { windowId: 1, hostAlive: true, nativeWindowAlive: true, enteredBackpackId: null };
    const snapshot = {
      schemaVersion: 1 as const,
      build: { version: '1.3.10', commit: 'abc1234', branch: 'main', builtAt: 'unknown', packaged: false },
      windows: [window],
      hermes: { placement: 'closed' as const, status: 'idle' as const, ownerWindowId: null },
    };
    const processIdentity = {
      pid: 321,
      appInstanceId: 'instance-a',
      startedAt: '2026-09-02T00:00:00.000Z',
      build: { version: '1.3.11', commit: 'abc1234', packaged: true },
      executableIdentity: { status: 'available', canonicalFileId: 'dev:7:ino:99' },
    };
    const dependencies = {
      snapshot: vi.fn(() => snapshot),
      windows: vi.fn(() => [window]),
      surfaces: () => [],
      surface: () => null,
      processIdentity: vi.fn(() => processIdentity),
      createWindow: vi.fn(async () => ({ windowId: 3 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot')))
      .resolves.toEqual(snapshot);
    await expect(dispatchPapersControl(dependencies, request('inspect.process')))
      .resolves.toEqual(processIdentity);
    await expect(dispatchPapersControl(dependencies, request('inspect.windows')))
      .resolves.toEqual([window]);
    await expect(dispatchPapersControl(dependencies, request('window.create')))
      .resolves.toEqual({ windowId: 3 });
  });

  it('returns only bounded visual diagnostics for the exact requested window/surface', async () => {
    const record = {
      sequence: 1,
      observedAt: '2026-09-02T00:00:00.000Z',
      target: { windowId: 4, surfaceId: 'surface-a' },
      payload: { kind: 'lifecycle' as const, phase: 'first-paint' as const },
    };
    const visualDiagnostics = vi.fn((target: { windowId: number; surfaceId?: string }) =>
      target.windowId === 4 && target.surfaceId === 'surface-a' ? [record] : null);
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: async () => ({ windowId: 3 }), visualDiagnostics,
    };
    await expect(dispatchPapersControl(dependencies, request('inspect.visual.diagnostics', {
      windowId: 4, surfaceId: 'surface-a',
    }))).resolves.toEqual([record]);
    await expect(dispatchPapersControl(dependencies, request('inspect.visual.diagnostics', {
      windowId: 5,
    }))).rejects.toThrow(/unavailable/);
    expect(visualDiagnostics).toHaveBeenCalledWith({ windowId: 5 });
  });

  it('validates subscriptions and emits only redacted semantic frames', async () => {
    const publishEvent = vi.fn();
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: vi.fn(async () => ({ windowId: 3 })), publishEvent,
    };

    await expect(dispatchPapersControl(dependencies, request('events.subscribe', {
      events: ['window.created', 'workspace.changed'],
    }))).resolves.toEqual({ subscribed: ['window.created', 'workspace.changed'] });
    await dispatchPapersControl(dependencies, request('window.create'));
    expect(publishEvent).toHaveBeenCalledWith('window.created', { windowId: 3 });
    expect(() => papersControlEventFrameSchema.parse({
      type: 'event', event: 'window.created', payload: {
        windowId: 3, url: 'papers-backpack://private', root: 'C:\\private', senderId: 8,
      },
    })).toThrow();
    await expect(dispatchPapersControl(dependencies, request('events.subscribe', {
      events: ['window.created', 'window.created'],
    }))).rejects.toThrow(/duplicates/);
  });

  it('requires and validates an exact live target for visual subscriptions', async () => {
    const validateVisualEventTarget = vi.fn((target: { windowId: number; surfaceId?: string }) =>
      target.windowId === 4 && target.surfaceId === 'surface-a');
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: async () => ({ windowId: 3 }), validateVisualEventTarget,
    };

    await expect(dispatchPapersControl(dependencies, request('events.subscribe', {
      events: ['visual.lifecycle'],
    }))).rejects.toThrow(/visualTarget/);
    await expect(dispatchPapersControl(dependencies, request('events.subscribe', {
      events: ['window.created'], visualTarget: { windowId: 4, surfaceId: 'surface-a' },
    }))).rejects.toThrow(/visualTarget/);
    await expect(dispatchPapersControl(dependencies, request('events.subscribe', {
      events: ['visual.diagnostic'], visualTarget: { windowId: 9, surfaceId: 'foreign' },
    }))).rejects.toThrow(/unavailable/);
    await expect(dispatchPapersControl(dependencies, request('events.subscribe', {
      events: ['visual.lifecycle', 'visual.diagnostic'], visualTarget: { windowId: 4, surfaceId: 'surface-a' },
    }))).resolves.toEqual({ subscribed: ['visual.lifecycle', 'visual.diagnostic'] });
    expect(validateVisualEventTarget).toHaveBeenCalledWith({ windowId: 4, surfaceId: 'surface-a' });
  });

  it('classifies only validated diagnostic records into visual event frames', () => {
    const record = {
      sequence: 1,
      observedAt: '2026-09-02T00:00:00.000Z',
      target: { windowId: 4, surfaceId: 'surface-a' },
      payload: { kind: 'lifecycle' as const, phase: 'first-paint' as const },
    };
    expect(papersControlEventFrameSchema.parse({ type: 'event', event: 'visual.lifecycle', payload: record })).toEqual({
      type: 'event', event: 'visual.lifecycle', payload: record,
    });
    expect(() => papersControlEventFrameSchema.parse({ type: 'event', event: 'visual.diagnostic', payload: record })).toThrow();
    expect(() => papersControlEventFrameSchema.parse({ type: 'event', event: 'visual.lifecycle', payload: {
      ...record, payload: { kind: 'console', level: 'error', message: 'not lifecycle' },
    } })).toThrow();
  });

  it('dispatches named-layout list/save/load with explicit window targets', async () => {
    const layout = {
      layoutId: '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c',
      name: 'Research',
      topology: createWorkspaceTopology(),
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: async () => ({ windowId: 3 }),
      listWorkspaceLayouts: vi.fn(async () => [layout]),
      saveWorkspaceLayout: vi.fn(async (_windowId: number, name: string) => ({ ...layout, name })),
      loadWorkspaceLayout: vi.fn(async (windowId: number, layoutId: string) => ({ windowId, layoutId, topology: layout.topology })),
    };

    await expect(dispatchPapersControl(dependencies, request('layout.list'))).resolves.toEqual([layout]);
    await expect(dispatchPapersControl(dependencies, request('layout.save', { windowId: 7, name: 'Saved' })))
      .resolves.toEqual({ ...layout, name: 'Saved' });
    await expect(dispatchPapersControl(dependencies, request('layout.load', { windowId: 7, layoutId: layout.layoutId })))
      .resolves.toEqual({ windowId: 7, layoutId: layout.layoutId, topology: layout.topology });
    expect(dependencies.saveWorkspaceLayout).toHaveBeenCalledWith(7, 'Saved');
    expect(dependencies.loadWorkspaceLayout).toHaveBeenCalledWith(7, layout.layoutId);
  });

  it('dispatches cross-window moves with explicit source and target without leaking URLs', async () => {
    const sourceTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'sf-moved', projectId: 'bp-a', title: 'A',
    });
    const targetTopology = openWorkspaceSurface(createWorkspaceTopology('target'), {
      surfaceId: 'sf-moved', projectId: 'bp-a', title: 'A',
    });
    const move = vi.fn(async (input: unknown) => ({
      surfaceId: 'sf-moved', sourceWindowId: 1, targetWindowId: 2,
      source: { projects: [], topology: createWorkspaceTopology() },
      target: { projects: [{ surfaceId: 'sf-moved', projectId: 'bp-a', title: 'A', url: 'papers-backpack://bp-a/private' }], topology: targetTopology },
      input,
      sourceTopology,
    }));
    const dependencies = {
      snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
      createWindow: async () => ({ windowId: 3 }),
      moveWorkspaceSurfaceAcrossWindows: move,
    };

    await expect(dispatchPapersControl(dependencies, request('layout.moveSurfaceToWindow', {
      sourceWindowId: 1, surfaceId: 'sf-moved', targetWindowId: 2,
      targetGroupId: 'target', targetIndex: 0,
    }))).resolves.toEqual({
      surfaceId: 'sf-moved', sourceWindowId: 1, targetWindowId: 2,
      sourceTopology: createWorkspaceTopology(), targetTopology,
    });
    expect(move).toHaveBeenCalledWith({
      sourceWindowId: 1, surfaceId: 'sf-moved', targetWindowId: 2,
      targetGroupId: 'target', targetIndex: 0,
    });
  });

  it('rejects unknown methods and unexpected parameters', async () => {
    expect(() => controlRequestSchema.parse({
      id: 1,
      token: 'secret',
      protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
      method: 'renderer.executeJavaScript',
      params: {},
    })).toThrow();

    await expect(dispatchPapersControl({
      snapshot: () => ({}),
      windows: () => [],
      surfaces: () => [],
      surface: () => null,
      createWindow: async () => ({}),
    }, request('window.create', { senderId: 10 }))).rejects.toThrow();
  });

  it('refuses to disclose Hermes error prose, which names the paths it searched', async () => {
    // describeMissingHermes() lists every location Hermes.exe was looked for.
    // That is the right message for the creator and exactly the wrong thing to
    // hand a control client.
    const leaky = {
      schemaVersion: 1 as const,
      build: { version: '1.3.10', commit: 'abc1234', branch: 'main', builtAt: 'unknown', packaged: false },
      windows: [],
      hermes: {
        placement: 'closed' as const,
        status: 'error' as const,
        detail: 'Papers could not find Hermes Desktop...\\n  • C:\\\\Users\\\\secret\\\\HermesAI\\\\Hermes.exe',
        ownerWindowId: null,
      },
    };
    const dependencies = {
      snapshot: vi.fn(() => leaky),
      windows: vi.fn(() => []),
      surfaces: () => [],
      surface: () => null,
      createWindow: vi.fn(async () => ({ windowId: 1 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot'))).rejects.toThrow();
  });

  it('refuses to disclose a snapshot carrying filesystem roots', async () => {
    // The contract is "no roots". Enforced here rather than trusted: widening
    // the renderer-facing build identity must not silently widen what the
    // control boundary discloses.
    const leaky = {
      schemaVersion: 1 as const,
      build: {
        version: '1.3.10',
        commit: 'abc1234',
        branch: 'main',
        builtAt: 'unknown',
        packaged: false,
        installDir: 'C:\Users\someone\AppData\Local\Papers',
        dataDir: 'C:\Users\someone\AppData\Roaming\Papers',
      },
      windows: [],
      hermes: { placement: 'closed' as const, status: 'idle' as const, ownerWindowId: null },
    };
    const dependencies = {
      snapshot: vi.fn(() => leaky),
      windows: vi.fn(() => []),
      surfaces: () => [],
      surface: () => null,
      createWindow: vi.fn(async () => ({ windowId: 1 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot'))).rejects.toThrow();
  });
});

describe('workspace mutation hardening', () => {
  const requestMutation = (method: 'layout.restore' | 'layout.split', params: unknown) => controlRequestSchema.parse({
    id: 'mutation', token: 'secret', protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION, method, params,
  });
  const one = openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
  const two = openWorkspaceSurface(one, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
  const split = splitWorkspaceGroup(two, {
    groupId: 'group-main', newGroupId: 'group-sf-b', surfaceId: 'sf-b',
    orientation: 'horizontal', position: 'after',
  });
  const surface = ({ windowId, surfaceId }: { windowId: number; surfaceId: string }) =>
    windowId === 1 && split.surfaces.some((candidate) => candidate.surfaceId === surfaceId)
      ? { windowId, surfaceId, projectId: 'bp', kind: 'project' as const, presentation: 'visible' as const }
      : null;
  const base = {
    snapshot: () => ({}), windows: () => [], surfaces: () => [], surface,
    createWindow: async () => ({ windowId: 1 }), workspace: () => ({ topology: split, revision: 1 }),
  };

  it('refuses cross-field-invalid restore before revision mutation', async () => {
    const invalid = { ...split, groups: split.groups.map((group) => ({ ...group, surfaceIds: [...group.surfaceIds, 'sf-a'] })) };
    const restoreWorkspace = vi.fn();
    await expect(dispatchPapersControl({ ...base, restoreWorkspace }, requestMutation('layout.restore', { windowId: 1, topology: invalid })))
      .rejects.toThrow();
    expect(restoreWorkspace).not.toHaveBeenCalled();
  });

  it('refuses an in-place split orientation change that cannot be exact', async () => {
    const restoreWorkspace = vi.fn();
    const vertical = { ...split, root: { ...split.root, orientation: 'vertical' as const } };
    await expect(dispatchPapersControl({ ...base, restoreWorkspace }, requestMutation('layout.restore', { windowId: 1, topology: vertical })))
      .rejects.toThrow(/orientation or root order/);
    expect(restoreWorkspace).not.toHaveBeenCalled();
  });

  it('allocates a fresh group id when the derived id survived earlier history', async () => {
    const collapsed = { ...two, groups: [{ ...two.groups[0]!, groupId: 'group-sf-b' }], root: { kind: 'group' as const, groupId: 'group-sf-b' }, focusedGroupId: 'group-sf-b' };
    const restoreWorkspace = vi.fn((_windowId, topology) => topology);
    await expect(dispatchPapersControl({ ...base, workspace: () => ({ topology: collapsed }), restoreWorkspace }, requestMutation('layout.split', { windowId: 1, surfaceId: 'sf-b', direction: 'right' })))
      .resolves.toMatchObject({ topology: { groups: expect.arrayContaining([expect.objectContaining({ groupId: 'group-sf-b-2' })]) } });
  });
});

/**
 * The first target-bearing control command. A query deliberately: the
 * authority properties are worth pinning before any control mutation can name
 * a surface, and inventing a mutation to exercise them would be the wrong way
 * round.
 */
describe('control surface targeting', () => {
  const SURFACE = {
    surfaceId: 'sf-1',
    windowId: 1,
    projectId: 'bp-a',
    kind: 'project' as const,
    presentation: 'visible' as const,
  };

  function deps(resolve: (target: { windowId: number; surfaceId: string }) => unknown) {
    return {
      surfaces: vi.fn(() => [SURFACE]),
      surface: vi.fn(resolve),
      snapshot: vi.fn(() => ({})),
      windows: vi.fn(() => []),
      createWindow: vi.fn(async () => ({ windowId: 1 })),
    };
  }

  /** The live registry, as the composition root resolves it. */
  const liveRegistry = ({ windowId, surfaceId }: { windowId: number; surfaceId: string }) =>
    (windowId === SURFACE.windowId && surfaceId === SURFACE.surfaceId ? SURFACE : null);

  function targeted(params: unknown) {
    return controlRequestSchema.parse({
      id: 'r1',
      token: 'secret',
      protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
      method: 'inspect.surface',
      params,
    });
  }

  it('lists live surfaces with identity and ownership only', async () => {
    await expect(dispatchPapersControl(deps(liveRegistry), request('inspect.surfaces')))
      .resolves.toEqual([SURFACE]);
  });

  it('returns the exact surface when window and surface agree', async () => {
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({ windowId: 1, surfaceId: 'sf-1' })))
      .resolves.toEqual(SURFACE);
  });

  it('returns only the validated Papers topology committed by an exact window', async () => {
    const topology = createWorkspaceTopology();
    const dependencies = { ...deps(liveRegistry), workspace: vi.fn((windowId: number) => windowId === 1 ? { topology, revision: 3 } : null) };
    await expect(dispatchPapersControl(dependencies, request('inspect.workspace', { windowId: 1 })))
      .resolves.toEqual({ windowId: 1, revision: 3, topology });
    await expect(dispatchPapersControl(dependencies, request('inspect.workspace', { windowId: 2 })))
      .rejects.toThrow(/has not committed/);
  });

  it('refuses an unknown surface', async () => {
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({ windowId: 1, surfaceId: 'sf-nope' })))
      .rejects.toThrow(/not open in that Papers window/);
  });

  it('refuses the right surface named with the wrong window', async () => {
    // Not resolved to the window it is actually in: that would be exactly the
    // proximity resolution this model exists to remove.
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({ windowId: 2, surfaceId: 'sf-1' })))
      .rejects.toThrow(/not open in that Papers window/);
  });

  it('refuses a retired surface', async () => {
    const retired = deps(() => null);
    await expect(dispatchPapersControl(retired, targeted({ windowId: 1, surfaceId: 'sf-1' })))
      .rejects.toThrow(/not open in that Papers window/);
  });

  it('refuses a target that does not name both ids', async () => {
    // The strict input schema is enforced at dispatch, so these are refused
    // there rather than at request parse.
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({ surfaceId: 'sf-1' }))).rejects.toThrow();
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({ windowId: 1 }))).rejects.toThrow();
    // There is no "the window's only surface" shortcut to fall back on.
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({}))).rejects.toThrow();
  });

  it('refuses extra parameters rather than ignoring them', async () => {
    await expect(dispatchPapersControl(deps(liveRegistry), targeted({ windowId: 1, surfaceId: 'sf-1', force: true })))
      .rejects.toThrow();
  });

  it('validates what it discloses, so a leaky surface projection is refused', async () => {
    const leaky = deps(() => ({ ...SURFACE, entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html' }));
    await expect(dispatchPapersControl(leaky, targeted({ windowId: 1, surfaceId: 'sf-1' })))
      .rejects.toThrow();
  });
});
