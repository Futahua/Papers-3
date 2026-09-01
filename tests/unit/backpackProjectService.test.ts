import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ABSENT_STATE_REVISION, BackpackProjectService, type BackpackProjectState } from '../../src/main/backpacks/backpackProjectService';

const backpackId = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const actionId = 'open-clips';

let root: string;
let projectRoot: string;
let bindingsFile: string;
let target: string;

async function hash(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function writeProject(overrides: Record<string, unknown> = {}): Promise<string[]> {
  await fs.mkdir(projectRoot, { recursive: true });
  target = path.join(root, 'local-action.cmd');
  await fs.writeFile(target, '@echo local', 'utf8');
  const projectFile = path.join(projectRoot, 'project.json');
  const actionsFile = path.join(projectRoot, 'actions.json');
  const publicRoot = path.join(projectRoot, 'public');
  const entryFile = path.join(publicRoot, 'index.html');
  await fs.mkdir(publicRoot, { recursive: true });
  await fs.writeFile(
    bindingsFile,
    JSON.stringify({
      schemaVersion: 1,
      projects: { [backpackId]: { root: projectRoot } },
    }),
    'utf8',
  );
  await fs.writeFile(
    projectFile,
    JSON.stringify({
      schemaVersion: 1,
      backpackId,
      entry: 'public/index.html',
      ...overrides,
    }),
    'utf8',
  );
  await fs.writeFile(
    actionsFile,
    JSON.stringify({
      schemaVersion: 1,
      actions: [{ id: actionId, target }],
    }),
    'utf8',
  );
  await fs.writeFile(entryFile, '<!doctype html><title>Local project</title>', 'utf8');
  return [bindingsFile, projectFile, actionsFile, entryFile];
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-backpack-project-'));
  projectRoot = path.join(root, 'independent-project');
  bindingsFile = path.join(root, 'backpack-projects.json');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('BackpackProjectService', () => {
  it('opens a bound external project without exposing its filesystem path', async () => {
    const files = await writeProject();
    const before = await Promise.all(files.map(hash));
    const service = new BackpackProjectService(bindingsFile);

    const opened = await service.open(backpackId);
    expect(opened?.url).toMatch(
      new RegExp(`^papers-backpack://${backpackId}/_papers-open/[0-9a-f-]+/public/index\\.html$`, 'i'),
    );
    expect(await Promise.all(files.map(hash))).toEqual(before);
  });

  it('runs only an action declared by that external project', async () => {
    await writeProject();
    const opened: string[] = [];
    const service = new BackpackProjectService(bindingsFile, async (selected) => {
      opened.push(selected);
      return '';
    });

    await service.runAction(backpackId, actionId);

    expect(opened).toEqual([path.resolve(target)]);
    await expect(service.runAction(backpackId, 'not-declared')).rejects.toThrow(/not found/i);
  });

  it('describes only existing absolute files and folders dropped from Windows', async () => {
    await writeProject();
    const folder = path.join(root, 'Dropped folder');
    const file = path.join(root, 'notes.txt');
    await fs.mkdir(folder);
    await fs.writeFile(file, 'notes', 'utf8');
    const service = new BackpackProjectService(bindingsFile);

    await expect(service.describeDroppedTargets([file, folder])).resolves.toEqual([
      { name: 'notes.txt', target: path.resolve(file), kind: 'file' },
      { name: 'Dropped folder', target: path.resolve(folder), kind: 'folder' },
    ]);
    await expect(service.describeDroppedTargets(['relative.txt'])).rejects.toThrow(/absolute/i);
  });

  it('loads the project-owned explorer state and atomically saves groups and shortcuts', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);
    const migrated = await service.loadState(backpackId);
    expect(migrated?.schemaVersion).toBe(1);
    expect(migrated?.shortcuts).toHaveLength(1);

    const state = {
      schemaVersion: 1,
      groups: [{ id: 'group-one', parentId: 'root', name: 'One' }],
      shortcuts: [{ id: 'shortcut-one', parentId: 'group-one', name: 'A', description: 'desc', target, icon: null }],
    };
    await service.saveState(backpackId, JSON.stringify(state));
    await expect(service.loadState(backpackId)).resolves.toEqual(state);
  });

  it('serializes overlapping state saves so the last requested state remains complete', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);
    const first = {
      schemaVersion: 1 as const,
      groups: [{ id: 'group-one', parentId: 'root', name: 'One' }],
      shortcuts: [{ id: 'shortcut-one', parentId: 'group-one', name: 'A', description: '', target, icon: null }],
    };
    const second = {
      schemaVersion: 1 as const,
      groups: [{ id: 'group-two', parentId: 'root', name: 'Two' }],
      shortcuts: [{ id: 'shortcut-two', parentId: 'group-two', name: 'B', description: '', target, icon: null }],
    };

    await Promise.all([
      service.saveState(backpackId, JSON.stringify(first)),
      service.saveState(backpackId, JSON.stringify(second)),
    ]);

    await expect(service.loadState(backpackId)).resolves.toEqual(second);
  });

  it('018V6: load waits for a same-project save and returns its committed snapshot', async () => {
    await writeProject();
    const initial = {
      schemaVersion: 1 as const,
      groups: [{ id: 'group-old', parentId: 'root', name: 'Old' }],
      shortcuts: [],
    };
    const next = {
      schemaVersion: 1 as const,
      groups: [{ id: 'group-new', parentId: 'root', name: 'New' }],
      shortcuts: [],
    };
    const base = new BackpackProjectService(bindingsFile);
    await base.saveState(backpackId, JSON.stringify(initial));
    let release!: () => void;
    const rename = vi.fn((from: string, to: string) => new Promise<void>((resolve) => {
      release = () => { void fs.rename(from, to).then(() => resolve()); };
    }));
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, { rename });
    const saving = service.saveState(backpackId, JSON.stringify(next));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    let loaded = false;
    const loading = service.loadState(backpackId).then((state) => { loaded = true; return state; });
    await Promise.resolve();
    expect(loaded).toBe(false);
    release();
    await saving;
    await expect(loading).resolves.toEqual(next);
  });

  it('018V6: different-project loads do not wait and failed saves leave old state readable', async () => {
    await writeProject();
    const otherId = 'bp-8f1e8c8b-8b3a-4e85-baa9-4a1a6b1f7db1';
    const otherRoot = path.join(root, 'other-project');
    await fs.mkdir(path.join(otherRoot, 'public'), { recursive: true });
    await fs.writeFile(path.join(otherRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: otherId, entry: 'public/index.html' }));
    await fs.writeFile(path.join(otherRoot, 'actions.json'), JSON.stringify({ schemaVersion: 1, actions: [] }));
    await fs.writeFile(path.join(otherRoot, 'public', 'index.html'), '<!doctype html>');
    await fs.writeFile(bindingsFile, JSON.stringify({ schemaVersion: 1, projects: {
      [backpackId]: { root: projectRoot }, [otherId]: { root: otherRoot },
    }}));
    const oldState = { schemaVersion: 1 as const, groups: [{ id: 'old', parentId: 'root', name: 'Old' }], shortcuts: [] };
    const base = new BackpackProjectService(bindingsFile);
    await base.saveState(backpackId, JSON.stringify(oldState));
    const failed = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: vi.fn(async () => { throw new Error('replacement failed'); }),
    });
    const saving = failed.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }));
    const savingError = saving.catch((error: unknown) => error);
    await expect(failed.loadState(otherId)).resolves.toEqual({ schemaVersion: 1, groups: [], shortcuts: [] });
    await expect(savingError).resolves.toMatchObject({ message: 'replacement failed' });
    await expect(failed.loadState(backpackId)).resolves.toEqual(oldState);
  });

  it('018V6R: project B load resolves while project A save remains pending', async () => {
    await writeProject();
    const otherId = 'bp-8f1e8c8b-8b3a-4e85-baa9-4a1a6b1f7db1';
    const otherRoot = path.join(root, 'other-project');
    await fs.mkdir(path.join(otherRoot, 'public'), { recursive: true });
    await fs.writeFile(path.join(otherRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: otherId, entry: 'public/index.html' }));
    await fs.writeFile(path.join(otherRoot, 'actions.json'), JSON.stringify({ schemaVersion: 1, actions: [] }));
    await fs.writeFile(path.join(otherRoot, 'public', 'index.html'), '<!doctype html>');
    await fs.writeFile(bindingsFile, JSON.stringify({ schemaVersion: 1, projects: {
      [backpackId]: { root: projectRoot }, [otherId]: { root: otherRoot },
    }}));
    let release!: () => void;
    const rename = vi.fn((from: string, to: string) => new Promise<void>((resolve) => {
      release = () => { void fs.rename(from, to).then(() => resolve()); };
    }));
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, { rename });
    const saving = service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    const otherLoad = service.loadState(otherId);
    await expect(otherLoad).resolves.toEqual({ schemaVersion: 1, groups: [], shortcuts: [] });
    release();
    await saving;
  });

  it('018V6R2: load drains appended same-project saves before reading state', async () => {
    await writeProject();
    const states = [
      { schemaVersion: 1 as const, groups: [{ id: 'a1', parentId: 'root', name: 'A1' }], shortcuts: [] },
      { schemaVersion: 1 as const, groups: [{ id: 'a2', parentId: 'root', name: 'A2' }], shortcuts: [] },
    ];
    const releases: Array<() => void> = [];
    const rename = vi.fn((from: string, to: string) => new Promise<void>((resolve) => {
      releases.push(() => { void fs.rename(from, to).then(() => resolve()); });
    }));
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, { rename });
    const savingA1 = service.saveState(backpackId, JSON.stringify(states[0]));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    const loading = service.loadState(backpackId);
    const savingA2 = service.saveState(backpackId, JSON.stringify(states[1]));
    releases[0]!();
    await vi.waitFor(() => expect(rename).toHaveBeenCalledTimes(2));
    let loaded: BackpackProjectState | null | undefined;
    void loading.then((state) => { loaded = state; });
    await Promise.resolve();
    expect(loaded).toBeUndefined();
    releases[1]!();
    await Promise.all([savingA1, savingA2]);
    await expect(loading).resolves.toEqual(states[1]);
  });

  it('0A: a save built on a stale revision is refused instead of overwriting', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {});
    const board = (name: string) => JSON.stringify({ schemaVersion: 1, groups: [{ id: name, parentId: 'root', name }], shortcuts: [] });

    // Two surfaces both read the same revision.
    const surfaceA = await service.loadStateVersioned(backpackId);
    const surfaceB = await service.loadStateVersioned(backpackId);
    expect(surfaceA.revision).toBe(surfaceB.revision);

    // B writes first and wins.
    const wroteB = await service.saveState(backpackId, board('B1'), surfaceB.revision);
    expect(wroteB.ok).toBe(true);

    // A now writes a whole board that predates B1. Without the check this
    // silently erases B1; with it, A is told to reload.
    const wroteA = await service.saveState(backpackId, board('A2'), surfaceA.revision);
    expect(wroteA).toMatchObject({ ok: false, code: 'STALE_REVISION' });

    const after = await service.loadStateVersioned(backpackId);
    expect(after.state.groups).toEqual([{ id: 'B1', parentId: 'root', name: 'B1' }]);
    expect(after.revision).toBe((wroteB as { revision: string }).revision);
  });

  it('0A: a save presenting the current revision lands and reports the next one', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {});
    const first = await service.loadStateVersioned(backpackId);
    const saved = await service.saveState(
      backpackId,
      JSON.stringify({ schemaVersion: 1, groups: [{ id: 'g', parentId: 'root', name: 'G' }], shortcuts: [] }),
      first.revision,
    );
    expect(saved.ok).toBe(true);
    const next = await service.loadStateVersioned(backpackId);
    expect(next.revision).toBe((saved as { revision: string }).revision);
    expect(next.revision).not.toBe(first.revision);

    // Re-presenting the revision that was just superseded is refused.
    await expect(
      service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }), first.revision),
    ).resolves.toMatchObject({ ok: false, code: 'STALE_REVISION' });
  });

  it('0A: an absent state file has its own revision, so only one writer creates it', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {});
    const seeded = await service.loadStateVersioned(backpackId);
    expect(seeded.revision).toBe(ABSENT_STATE_REVISION);

    const created = await service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }), ABSENT_STATE_REVISION);
    expect(created.ok).toBe(true);

    // A second surface that also believed the file was absent must not clobber it.
    await expect(
      service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [{ id: 'x', parentId: 'root', name: 'X' }], shortcuts: [] }), ABSENT_STATE_REVISION),
    ).resolves.toMatchObject({ ok: false, code: 'STALE_REVISION' });
  });

  it('0A: an edit made outside Papers is caught by the same check', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {});
    await service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }));
    const observed = await service.loadStateVersioned(backpackId);

    await fs.writeFile(
      path.join(projectRoot, 'state.json'),
      JSON.stringify({ schemaVersion: 1, groups: [{ id: 'outside', parentId: 'root', name: 'Outside' }], shortcuts: [] }, null, 2) + '\n',
      'utf8',
    );

    await expect(
      service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }), observed.revision),
    ).resolves.toMatchObject({ ok: false, code: 'STALE_REVISION' });
  });

  it('0A: a save with no expected revision still writes, keeping the single-writer path', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {});
    await service.saveState(backpackId, JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }));
    const written = await service.saveState(
      backpackId,
      JSON.stringify({ schemaVersion: 1, groups: [{ id: 'legacy', parentId: 'root', name: 'Legacy' }], shortcuts: [] }),
    );
    expect(written.ok).toBe(true);
    await expect(service.loadState(backpackId)).resolves.toMatchObject({
      groups: [{ id: 'legacy', parentId: 'root', name: 'Legacy' }],
    });
  });

  it('launches only a shortcut target held by the project state', async () => {
    await writeProject();
    const opened: string[] = [];
    const service = new BackpackProjectService(bindingsFile, async (selected) => {
      opened.push(selected);
      return '';
    });
    await service.saveState(backpackId, JSON.stringify({
      schemaVersion: 1,
      groups: [],
      shortcuts: [{ id: 'shortcut-one', parentId: 'root', name: 'A', description: '', target, icon: null }],
    }));
    await service.launchShortcut(backpackId, 'shortcut-one');
    expect(opened).toEqual([path.resolve(target)]);
    await expect(service.launchShortcut(backpackId, 'not-found')).rejects.toThrow(/not found/i);
  });

  it('reveals only a shortcut target held by the project state, never a web link', async () => {
    await writeProject();
    const revealed: string[] = [];
    const service = new BackpackProjectService(
      bindingsFile,
      undefined,
      undefined,
      async (selected) => {
        revealed.push(selected);
      },
    );
    await service.saveState(backpackId, JSON.stringify({
      schemaVersion: 1,
      groups: [],
      shortcuts: [
        { id: 'shortcut-one', parentId: 'root', name: 'A', description: '', target, icon: null },
        {
          id: 'shortcut-web',
          parentId: 'root',
          name: 'Web',
          description: '',
          target: 'https://example.com/news',
          icon: null,
        },
      ],
    }));

    await service.revealShortcut(backpackId, 'shortcut-one');
    expect(revealed).toEqual([path.resolve(target)]);

    await expect(service.revealShortcut(backpackId, 'shortcut-web')).rejects.toThrow(/not found/i);
    expect(revealed).toEqual([path.resolve(target)]);
    await expect(service.revealShortcut(backpackId, 'not-found')).rejects.toThrow(/not found/i);
  });

  it('resolves a Windows icon only for a shortcut target already held by project state', async () => {
    await writeProject();
    const requested: string[] = [];
    const service = new BackpackProjectService(
      bindingsFile,
      async () => '',
      async (selected) => {
        requested.push(selected);
        return 'data:image/png;base64,target-icon';
      },
    );
    await service.saveState(backpackId, JSON.stringify({
      schemaVersion: 1,
      groups: [],
      shortcuts: [{
        id: 'shortcut-one',
        parentId: 'root',
        name: 'A',
        description: '',
        target,
        icon: null,
      }],
    }));

    await expect(service.shortcutIcon(backpackId, 'shortcut-one')).resolves.toBe(
      'data:image/png;base64,target-icon',
    );
    expect(requested).toEqual([path.resolve(target)]);
    await expect(service.shortcutIcon(backpackId, 'not-found')).rejects.toThrow(/not found/i);
  });

  it('returns no default icon when Windows cannot resolve one', async () => {
    await writeProject();
    const service = new BackpackProjectService(
      bindingsFile,
      async () => '',
      async () => null,
    );
    await service.saveState(backpackId, JSON.stringify({
      schemaVersion: 1,
      groups: [],
      shortcuts: [{
        id: 'shortcut-one',
        parentId: 'root',
        name: 'A',
        description: '',
        target,
        icon: null,
      }],
    }));

    await expect(service.shortcutIcon(backpackId, 'shortcut-one')).resolves.toBeNull();
  });

  it('rejects project state that tries to turn a shortcut into an arbitrary relative path', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);
    await expect(service.saveState(backpackId, JSON.stringify({
      schemaVersion: 1,
      groups: [],
      shortcuts: [{ id: 'shortcut-one', parentId: 'root', name: 'A', description: '', target: 'relative.cmd', icon: null }],
    }))).rejects.toThrow(/absolute paths/i);
  });

  it('persists validated http(s) web links without accepting other URL schemes', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);
    const webState = {
      schemaVersion: 1,
      groups: [],
      shortcuts: [{
        id: 'shortcut-web',
        parentId: 'root',
        name: 'Web',
        description: '',
        target: 'https://example.com/news',
        icon: null,
      }],
    };

    await expect(service.saveState(backpackId, JSON.stringify(webState))).resolves.toMatchObject({ ok: true });
    await expect(service.loadState(backpackId)).resolves.toEqual(webState);

    webState.shortcuts[0]!.target = 'javascript:alert(1)';
    await expect(service.saveState(backpackId, JSON.stringify(webState))).rejects.toThrow(
      /absolute paths or http\(s\)/i,
    );
  });

  it('re-reads local project files without rebuilding or restarting Papers', async () => {
    await writeProject();
    const opened: string[] = [];
    const service = new BackpackProjectService(bindingsFile, async (selected) => {
      opened.push(selected);
      return '';
    });

    const firstOpening = await service.open(backpackId);
    expect(firstOpening?.url).toMatch(/\/_papers-open\/[0-9a-f-]+\/public\/index\.html$/i);

    const alternateEntry = path.join(projectRoot, 'public', 'updated.html');
    const alternateTarget = path.join(root, 'updated-action.cmd');
    await fs.writeFile(alternateEntry, '<!doctype html><title>Updated locally</title>', 'utf8');
    await fs.writeFile(alternateTarget, '@echo updated', 'utf8');
    await fs.writeFile(
      path.join(projectRoot, 'project.json'),
      JSON.stringify({ schemaVersion: 1, backpackId, entry: 'public/updated.html' }),
      'utf8',
    );
    await fs.writeFile(
      path.join(projectRoot, 'actions.json'),
      JSON.stringify({
        schemaVersion: 1,
        actions: [{ id: actionId, target: alternateTarget }],
      }),
      'utf8',
    );

    const secondOpening = await service.open(backpackId);
    expect(secondOpening?.url).toMatch(/\/_papers-open\/[0-9a-f-]+\/public\/updated\.html$/i);
    await service.runAction(backpackId, actionId);
    expect(opened).toEqual([path.resolve(alternateTarget)]);
  });

  it('gives each project opening a fresh asset namespace so local edits cannot stay cached', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);

    const first = await service.open(backpackId);
    const second = await service.open(backpackId);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.url).not.toBe(first?.url);
    expect(new URL(first!.url).pathname).toMatch(
      /^\/_papers-open\/[0-9a-f-]+\/public\/index\.html$/i,
    );
    await expect(
      service.resolveAsset(backpackId, new URL(first!.url).pathname),
    ).resolves.toBe(path.join(projectRoot, 'public', 'index.html'));
  });

  it('serves only files inside the bound project root', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);

    await expect(service.resolveAsset(backpackId, '/public/index.html')).resolves.toBe(
      path.join(projectRoot, 'public', 'index.html'),
    );
    await expect(service.resolveAsset(backpackId, '/public/../outside.txt')).rejects.toThrow(
      /outside/i,
    );
    const missing = await service.resolveAsset(backpackId, '/public/missing.html').catch(String);
    expect(missing).not.toContain(projectRoot);
    expect(missing).toMatch(/could not be read/i);
  });

  it('never serves its private manifest or action targets as project assets', async () => {
    await writeProject();
    const service = new BackpackProjectService(bindingsFile);

    await expect(service.resolveAsset(backpackId, '/project.json')).rejects.toThrow(
      /not public/i,
    );
    await expect(service.resolveAsset(backpackId, '/actions.json')).rejects.toThrow(
      /not public/i,
    );
    const alias = path.join(projectRoot, 'public', 'private-alias');
    await fs.symlink(projectRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      service.resolveAsset(backpackId, '/public/private-alias/actions.json'),
    ).rejects.toThrow(/outside/i);

    await fs.rm(path.join(projectRoot, 'public'), { recursive: true, force: true });
    const outsidePublic = path.join(root, 'outside-public');
    await fs.mkdir(outsidePublic);
    await fs.writeFile(
      path.join(outsidePublic, 'index.html'),
      '<!doctype html><title>Outside project</title>',
      'utf8',
    );
    await fs.symlink(
      outsidePublic,
      path.join(projectRoot, 'public'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(service.resolveAsset(backpackId, '/public/index.html')).rejects.toThrow(
      /outside/i,
    );
  });

  it('fails closed for a missing binding, mismatched project, or escaping entry', async () => {
    const service = new BackpackProjectService(bindingsFile);
    await expect(service.open(backpackId)).resolves.toBeNull();

    await writeProject({ backpackId: 'bp-00000000-0000-4000-8000-000000000000' });
    await expect(service.open(backpackId)).rejects.toThrow(/does not match/i);

    await writeProject({ entry: '../outside.html' });
    await expect(service.open(backpackId)).rejects.toThrow(/outside/i);
  });

  // ---------------------------------------------------------------------------
  // Transient state replacement (Assignment 006): Windows intermittently
  // denies the state.json rename with EPERM while another process briefly
  // holds a deny-delete/replace handle. The replacement retries only that
  // transient contention for a short bounded interval; the old complete state
  // stays readable throughout, and exhausted or non-transient errors surface
  // with their original context. The rename/delay boundary is injected, so
  // these tests exercise the real retry behavior with no real-time sleeps.
  // ---------------------------------------------------------------------------

  function transientError(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`rename ${code}`), { code });
  }

  function validState(name: string) {
    return {
      schemaVersion: 1 as const,
      groups: [{ id: `group-${name}`, parentId: 'root', name }],
      shortcuts: [],
    };
  }

  async function tempFiles(): Promise<string[]> {
    return (await fs.readdir(projectRoot)).filter((file) => file.includes('.tmp-'));
  }

  it('retries transient EPERM contention and resolves with the complete state', async () => {
    await writeProject();
    const delays: number[] = [];
    let failuresLeft = 2;
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: async (from, to) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw transientError('EPERM');
        }
        await fs.rename(from, to);
      },
      delay: async (ms) => { delays.push(ms); },
    });

    const state = validState('one');
    await service.saveState(backpackId, JSON.stringify(state));

    expect(failuresLeft).toBe(0);
    expect(delays).toEqual([25, 50]);
    await expect(service.loadState(backpackId)).resolves.toEqual(state);
    await expect(tempFiles()).resolves.toEqual([]);
  });

  it('EBUSY and ENOTEMPTY follow the same bounded retry path', async () => {
    for (const code of ['EBUSY', 'ENOTEMPTY'] as const) {
      await writeProject();
      const delays: number[] = [];
      let failuresLeft = 1;
      const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
        rename: async (from, to) => {
          if (failuresLeft > 0) {
            failuresLeft -= 1;
            throw transientError(code);
          }
          await fs.rename(from, to);
        },
        delay: async (ms) => { delays.push(ms); },
      });

      const state = validState(code);
      await service.saveState(backpackId, JSON.stringify(state));
      expect(delays).toEqual([25]);
      await expect(service.loadState(backpackId)).resolves.toEqual(state);
    }
  });

  it('a non-transient error is attempted once and rethrown unchanged', async () => {
    await writeProject();
    const delays: number[] = [];
    const permanent = transientError('EACCES');
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: async () => { throw permanent; },
      delay: async (ms) => { delays.push(ms); },
    });

    await expect(
      service.saveState(backpackId, JSON.stringify(validState('never'))),
    ).rejects.toBe(permanent);
    expect(delays).toEqual([]);
  });

  it('persistent transient failure stops at the attempt limit, keeps the old state, cleans the temp file', async () => {
    await writeProject();
    const first = validState('first');
    const service = new BackpackProjectService(bindingsFile);
    await service.saveState(backpackId, JSON.stringify(first));
    const originalBytes = await fs.readFile(path.join(projectRoot, 'state.json'));

    const delays: number[] = [];
    const failing = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: async () => { throw transientError('EPERM'); },
      delay: async (ms) => { delays.push(ms); },
    });

    await expect(
      failing.saveState(backpackId, JSON.stringify(validState('second'))),
    ).rejects.toMatchObject({ code: 'EPERM' });

    expect(delays).toEqual([25, 50, 100, 200, 400]);
    expect(await fs.readFile(path.join(projectRoot, 'state.json'))).toEqual(originalBytes);
    await expect(tempFiles()).resolves.toEqual([]);
  });

  it('a successful retry leaves no temp file behind', async () => {
    await writeProject();
    let failuresLeft = 1;
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: async (from, to) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw transientError('EPERM');
        }
        await fs.rename(from, to);
      },
      delay: async () => undefined,
    });

    await service.saveState(backpackId, JSON.stringify(validState('clean')));
    await expect(tempFiles()).resolves.toEqual([]);
  });

  it('overlapping saves stay serialized and the last requested state wins even while the first retries', async () => {
    await writeProject();
    const delays: number[] = [];
    let released = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let failuresLeft = 1;
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: async (from, to) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw transientError('EPERM');
        }
        await fs.rename(from, to);
      },
      delay: async (ms) => {
        delays.push(ms);
        if (!released) await gate;
      },
    });

    const firstSave = service.saveState(backpackId, JSON.stringify(validState('first')));
    // The first save's retry delay is held open, so the second request queues.
    const secondSave = service.saveState(backpackId, JSON.stringify(validState('second')));
    released = true;
    release();

    await Promise.all([firstSave, secondSave]);
    expect(delays).toEqual([25]);
    await expect(service.loadState(backpackId)).resolves.toEqual(validState('second'));
  });

  it('a queued save still runs after an earlier save exhausts retries', async () => {
    await writeProject();
    const delays: number[] = [];
    // The first save's replacement exhausts all six attempts; from then on
    // the rename succeeds, so the queued next save persists normally.
    let attempts = 0;
    const service = new BackpackProjectService(bindingsFile, undefined, undefined, undefined, {
      rename: async (from, to) => {
        attempts += 1;
        if (attempts <= 6) throw transientError('EPERM');
        await fs.rename(from, to);
      },
      delay: async (ms) => { delays.push(ms); },
    });
    await expect(
      service.saveState(backpackId, JSON.stringify(validState('lost'))),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(delays).toEqual([25, 50, 100, 200, 400]);

    // The queue recovers: the next save runs normally and persists its state.
    await service.saveState(backpackId, JSON.stringify(validState('recovered')));
    await expect(service.loadState(backpackId)).resolves.toEqual(validState('recovered'));
  });
});
