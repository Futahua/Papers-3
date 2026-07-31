import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BackpackProjectService } from '../../src/main/backpacks/backpackProjectService';

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

    await expect(service.saveState(backpackId, JSON.stringify(webState))).resolves.toBeUndefined();
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
});
