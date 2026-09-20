/**
 * Which project Alt+A launches.
 *
 * The defect these tests pin down: the launcher used to render whatever project
 * happened to be the ACTIVE TAB. The creator presses the chord from outside
 * Papers, so the front tab is invisible to them and effectively random - they
 * got Proxima's task board, which declares no command surface at all, squeezed
 * into a 640x220 letterbox.
 *
 * The rule these tests hold: the launcher targets a project that DECLARES one,
 * never the project that happens to be in front.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  declarationFromManifest,
  LAUNCHER_SURFACE_FIELD,
  createCommandSurfaceRegistry,
  type CommandSurfaceRegistryDependencies,
  type OpenProject,
  type ProjectLauncherDeclaration,
} from '../../src/main/backpacks/commandSurfaceRegistry';

const PROXIMA = 'bp-11111111-1111-4111-8111-111111111111';
const PAPERS3 = 'bp-22222222-2222-4222-8222-222222222222';
const THIRD = 'bp-33333333-3333-4333-8333-333333333333';

function declared(surface = 'command-surface'): ProjectLauncherDeclaration {
  return { schemaVersion: 1, surface };
}

function harness(options: {
  open: OpenProject[];
  declarations?: Record<string, ProjectLauncherDeclaration>;
  nominated?: string | null;
}) {
  const reads: string[] = [];
  const nominations: Array<string | null> = [];
  const deps: CommandSurfaceRegistryDependencies = {
    openProjects: () => options.open,
    readDeclaration: async (projectId) => {
      reads.push(projectId);
      return options.declarations?.[projectId] ?? null;
    },
    nominatedProjectId: () => options.nominated ?? null,
    nominate: (projectId) => { nominations.push(projectId); },
  };
  return { deps, reads, nominations };
}

describe('the launcher target is the project that declares one', () => {
  it('ignores the front project when it declares nothing and another project does', async () => {
    // The exact reported defect. Proxima is in front; Papers-3 declares.
    const h = harness({
      open: [
        { projectId: PROXIMA, root: 'C:\\proxima' },
        { projectId: PAPERS3, root: 'C:\\papers3' },
      ],
      declarations: { [PAPERS3]: declared() },
    });
    const registry = createCommandSurfaceRegistry(h.deps);
    const result = await registry.resolve();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.target.projectId).toBe(PAPERS3);
    expect(result.target.surfaceId).toBe('command-surface');
  });

  it('does NOT follow a tab change between two declared projects', async () => {
    // The rule must be stable when the creator switches tabs. Two declared
    // projects is ambiguous, so the answer is a refusal - the same answer no
    // matter which of them is in front.
    const open = [
      { projectId: PAPERS3, root: 'C:\\papers3' },
      { projectId: THIRD, root: 'C:\\third' },
    ];
    const declarations = { [PAPERS3]: declared(), [THIRD]: declared('quick-run') };

    const first = await createCommandSurfaceRegistry(harness({ open, declarations }).deps).resolve();
    const second = await createCommandSurfaceRegistry(
      harness({ open: [...open].reverse(), declarations }).deps,
    ).resolve();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) throw new Error('unreachable');
    // Identical answer, so the chord cannot become a different feature.
    expect(first.reason).toBe(second.reason);
    expect(first.detail).toBe(second.detail);
  });

  it('answers a nominated project even when several declare one', async () => {
    const h = harness({
      open: [
        { projectId: PAPERS3, root: 'C:\\papers3' },
        { projectId: THIRD, root: 'C:\\third' },
      ],
      declarations: { [PAPERS3]: declared(), [THIRD]: declared('quick-run') },
      nominated: THIRD,
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.target.projectId).toBe(THIRD);
    expect(result.target.surfaceId).toBe('quick-run');
  });

  it('lets the nomination outrank a sole declared project, so it means one thing', async () => {
    const h = harness({
      open: [
        { projectId: PAPERS3, root: 'C:\\papers3' },
        { projectId: THIRD, root: 'C:\\third' },
      ],
      declarations: { [PAPERS3]: declared(), [THIRD]: declared('quick-run') },
      nominated: PAPERS3,
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.target.projectId).toBe(PAPERS3);
  });
});

describe('the launcher refuses visibly rather than rendering something else', () => {
  it('refuses when the only open project declares no command surface', async () => {
    // Proxima alone. It must NOT be rendered into a launcher-shaped window.
    const h = harness({
      open: [{ projectId: PROXIMA, root: 'C:\\proxima' }],
      declarations: {},
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('none-declare-a-command-surface');
    // Says something true: which projects are open, and what each lacks.
    expect(result.detail).toContain(PROXIMA);
    expect(result.detail).toContain('does not declare');
    expect(result.detail).not.toContain('not reachable');
  });

  it('refuses when no project is open at all', async () => {
    const h = harness({ open: [], declarations: {} });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no-project-open');
    expect(result.detail).toContain('no Backpack project is open');
  });

  it('refuses when two projects declare one and says how to settle it', async () => {
    const h = harness({
      open: [
        { projectId: PAPERS3, root: 'C:\\papers3' },
        { projectId: THIRD, root: 'C:\\third' },
      ],
      declarations: { [PAPERS3]: declared(), [THIRD]: declared('quick-run') },
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('several-declare-a-command-surface');
    // Names the candidates, because the creator cannot see the front tab.
    expect(result.detail).toContain(PAPERS3);
    expect(result.detail).toContain(THIRD);
    expect(result.candidates).toEqual([PAPERS3, THIRD]);
  });

  it('refuses when the nominated project is not open, rather than launching another', async () => {
    const h = harness({
      open: [{ projectId: PROXIMA, root: 'C:\\proxima' }],
      declarations: {},
      nominated: PAPERS3,
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('nominated-project-not-open');
    expect(result.detail).toContain(PAPERS3);
    expect(result.detail).not.toContain(PROXIMA);
  });

  it('refuses when the nominated project is open but declares nothing', async () => {
    // A nomination left pointing at a project whose surface was removed must
    // not silently fall back to rendering a project with no command surface.
    const h = harness({
      open: [
        { projectId: PROXIMA, root: 'C:\\proxima' },
        { projectId: PAPERS3, root: 'C:\\papers3' },
      ],
      declarations: { [PAPERS3]: declared() },
      nominated: PROXIMA,
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('nominated-project-declares-nothing');
    expect(result.detail).toContain(PROXIMA);
    // Papers-3 declares one, and still must not be substituted: the creator
    // nominated Proxima, and a silent swap is the bug this round is fixing.
    expect(result.detail).toContain('nominate');
  });

  it('treats an unreadable declaration as no declaration, never as a command surface', async () => {
    const h = harness({
      open: [{ projectId: PAPERS3, root: 'C:\\papers3' }],
      declarations: {},
    });
    const deps = { ...h.deps, readDeclaration: vi.fn(async () => { throw new Error('EACCES'); }) };
    const result = await createCommandSurfaceRegistry(deps).resolve();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('none-declare-a-command-surface');
  });

  it('deduplicates a project presented in two windows so it is not counted as two', async () => {
    const h = harness({
      open: [
        { projectId: PAPERS3, root: 'C:\\papers3' },
        { projectId: PAPERS3, root: 'C:\\papers3' },
      ],
      declarations: { [PAPERS3]: declared() },
    });
    const result = await createCommandSurfaceRegistry(h.deps).resolve();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.target.projectId).toBe(PAPERS3);
  });
});

describe('the nomination is the creator\'s, not the host\'s guess', () => {
  it('writes the nomination through to whoever owns it, and reads it back', async () => {
    const h = harness({ open: [], declarations: {} });
    const registry = createCommandSurfaceRegistry(h.deps);

    registry.nominate(PAPERS3);
    registry.nominate(null);

    // The registry decides; it does not own the choice. Both directions go
    // through the injected store, so the creator's setting is the only copy.
    expect(h.nominations).toEqual([PAPERS3, null]);
    expect(registry.nominatedProjectId()).toBeNull();
  });
});

describe('the declaration a project states', () => {
  it('reads the marker the project declares, without interpreting it', () => {
    const declaration = declarationFromManifest({
      schemaVersion: 1,
      backpackId: PAPERS3,
      entry: 'public/index.html',
      [LAUNCHER_SURFACE_FIELD]: 'quick-run',
    });
    expect(declaration).toEqual({ schemaVersion: 1, surface: 'quick-run' });
  });

  it.each([
    ['a project that declares nothing', { schemaVersion: 1, backpackId: PAPERS3, entry: 'public/index.html' }],
    ['an empty surface marker', { schemaVersion: 1, backpackId: PAPERS3, entry: 'public/index.html', [LAUNCHER_SURFACE_FIELD]: '' }],
    ['a non-string surface marker', { schemaVersion: 1, backpackId: PAPERS3, entry: 'public/index.html', [LAUNCHER_SURFACE_FIELD]: 7 }],
    ['a marker carrying a URL, which could not be an opaque token', { schemaVersion: 1, backpackId: PAPERS3, entry: 'public/index.html', [LAUNCHER_SURFACE_FIELD]: 'http://127.0.0.1:4181/' }],
    ['a marker with whitespace', { schemaVersion: 1, backpackId: PAPERS3, entry: 'public/index.html', [LAUNCHER_SURFACE_FIELD]: 'command surface' }],
  ])('%s declares no command surface', (_label, manifest) => {
    expect(declarationFromManifest(manifest)).toBeNull();
  });

  it('does not read the declaration out of anything but the manifest', () => {
    // The declaration is a control record the project ships, not something the
    // host infers from a name, a title, a route or a running page.
    expect(declarationFromManifest(null)).toBeNull();
    expect(declarationFromManifest('command-surface')).toBeNull();
    expect(declarationFromManifest([{ surface: 'command-surface' }])).toBeNull();
  });
});
