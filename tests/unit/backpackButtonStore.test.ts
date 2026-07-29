import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BackpackButtonStore } from '../../src/main/backpacks/backpackButtonStore';

let dataDir: string;
let sharedDir: string;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-buttons-'));
  dataDir = path.join(root, 'Data');
  sharedDir = path.join(root, 'Shared');
});

afterEach(async () => {
  await fs.rm(path.dirname(dataDir), { recursive: true, force: true });
});

describe('BackpackButtonStore', () => {
  it('persists a creator-named target under Shared and restores it after restart', async () => {
    const target = path.join(path.dirname(dataDir), 'hello.cmd');
    await fs.writeFile(target, '@echo hello', 'utf8');

    const first = new BackpackButtonStore({ dataDir, sharedDir });
    const created = await first.create('bp-first', 'Say hello', target);

    expect(created.id).toMatch(/^button-/);
    expect(created.label).toBe('Say hello');
    expect(created.target).toBe(path.resolve(target));

    const second = new BackpackButtonStore({ dataDir, sharedDir });
    expect(await second.list('bp-first')).toEqual([created]);
    await expect(
      fs.readFile(path.join(sharedDir, 'backpacks', 'bp-first', 'buttons.json'), 'utf8'),
    ).resolves.toContain('Say hello');
  });

  it('removes a button without affecting another Backpack', async () => {
    const target = path.join(path.dirname(dataDir), 'hello.cmd');
    await fs.writeFile(target, '@echo hello', 'utf8');
    const store = new BackpackButtonStore({ dataDir, sharedDir });
    const first = await store.create('bp-first', 'First', target);
    await store.create('bp-second', 'Second', target);

    await store.remove('bp-first', first.id);

    expect(await store.list('bp-first')).toEqual([]);
    expect((await store.list('bp-second')).map((button) => button.label)).toEqual(['Second']);
  });

  it('launches only the stored target selected by button id', async () => {
    const target = path.join(path.dirname(dataDir), 'hello.cmd');
    await fs.writeFile(target, '@echo hello', 'utf8');
    const opened: string[] = [];
    const store = new BackpackButtonStore(
      { dataDir, sharedDir },
      async (selected) => {
        opened.push(selected);
        return '';
      },
    );
    const button = await store.create('bp-first', 'First', target);

    await store.launch('bp-first', button.id);

    expect(opened).toEqual([path.resolve(target)]);
    await expect(store.launch('bp-first', 'button-missing')).rejects.toThrow(/not found/);
  });
});
