import { describe, expect, it, vi } from 'vitest';

import {
  controlRequestSchema,
  dispatchPapersControl,
  PAPERS_CONTROL_PROTOCOL_VERSION,
} from '../../src/main/control/papersControlProtocol';
import { createWorkspaceTopology } from '../../src/shared/workspaceTopology';

function request(method: 'inspect.snapshot' | 'inspect.windows' | 'inspect.surfaces' | 'inspect.surface' | 'inspect.workspace' | 'window.create', params: unknown = {}) {
  return controlRequestSchema.parse({
    id: 'r1',
    token: 'secret',
    protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
    method,
    params,
  });
}

describe('Papers developer control protocol', () => {
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
    const dependencies = {
      snapshot: vi.fn(() => snapshot),
      windows: vi.fn(() => [window]),
      surfaces: () => [],
      surface: () => null,
      createWindow: vi.fn(async () => ({ windowId: 3 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot')))
      .resolves.toEqual(snapshot);
    await expect(dispatchPapersControl(dependencies, request('inspect.windows')))
      .resolves.toEqual([window]);
    await expect(dispatchPapersControl(dependencies, request('window.create')))
      .resolves.toEqual({ windowId: 3 });
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
    const dependencies = { ...deps(liveRegistry), workspace: vi.fn((windowId: number) => windowId === 1 ? topology : null) };
    await expect(dispatchPapersControl(dependencies, request('inspect.workspace', { windowId: 1 })))
      .resolves.toEqual({ windowId: 1, topology });
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
