import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RemoteFileResources } from '../src/main/backpacks/remoteFileResources';

const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-remote-files-'));
  fixtures.push(directory);
  await fs.mkdir(path.join(directory, 'shared'));
  await fs.writeFile(path.join(directory, 'shared', 'hello.txt'), 'original');
  const catalog = await RemoteFileResources.create([{ id: 'approved', name: 'Documents', directory: path.join(directory, 'shared') }]);
  const root = (await catalog.shares())[0]!;
  return { directory, catalog, root };
}
describe('remote file resource boundary', () => {
  it('retains opaque identities across restarts of the same grant', async () => {
    const { directory } = await fixture();
    const shares = [{ id: 'stable-share', name: 'Documents', directory: path.join(directory, 'shared') }];
    const first = await RemoteFileResources.create(shares, 'stable-private-grant');
    const second = await RemoteFileResources.create(shares, 'stable-private-grant');
    const firstRoot = (await first.shares())[0]!;
    const secondRoot = (await second.shares())[0]!;
    expect(secondRoot.id).toBe(firstRoot.id);
    expect((await second.list(secondRoot.id)).entries[0]!.id).toBe((await first.list(firstRoot.id)).entries[0]!.id);
  });
  it('lists approved files with stable session IDs and no owner path disclosure', async () => {
    const { directory, catalog, root } = await fixture();
    const first = await catalog.list(root.id);
    const second = await catalog.list(root.id);
    expect(first.entries[0]!.id).toBe(second.entries[0]!.id);
    expect(first.entries[0]!.name).toBe('hello.txt');
    expect(JSON.stringify([root, first])).not.toContain(directory);
    await expect(catalog.stat(path.join(directory, 'shared', 'hello.txt'))).rejects.toMatchObject({ code: 'RESOURCE_UNKNOWN' });
    await expect(catalog.list(root.id, -1)).rejects.toMatchObject({ code: 'PAGE_INVALID' });
  });
  it('refuses stale versions and detects edits during an open transfer', async () => {
    const { directory, catalog, root } = await fixture();
    const entry = (await catalog.list(root.id)).entries[0]!;
    const lease = await catalog.open(entry.id, entry.version);
    expect(await lease.handle.readFile('utf8')).toBe('original');
    await fs.writeFile(path.join(directory, 'shared', 'hello.txt'), 'changed and longer');
    await expect(lease.verify()).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
    await lease.handle.close();
    await expect(catalog.open(entry.id, entry.version)).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
  });
  it('excludes external junctions and refuses a previously shared directory redirected outside', async () => {
    const { directory, catalog, root } = await fixture();
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'private');
    await fs.symlink(outside, path.join(directory, 'shared', 'external'), 'junction');
    const inner = path.join(directory, 'shared', 'inner');
    await fs.mkdir(inner);
    const listing = await catalog.list(root.id);
    expect(listing.entries.some(entry => entry.name === 'external')).toBe(false);
    const innerEntry = listing.entries.find(entry => entry.name === 'inner')!;
    await fs.rmdir(inner);
    await fs.symlink(outside, inner, 'junction');
    await expect(catalog.list(innerEntry.id)).rejects.toMatchObject({ code: 'RESOURCE_OUTSIDE_SHARE' });
  });
  it('does not allow resource IDs from another device session', async () => {
    const { directory, root } = await fixture();
    const other = await RemoteFileResources.create([{ id: 'approved', name: 'Documents', directory: path.join(directory, 'shared') }]);
    await expect(other.list(root.id)).rejects.toMatchObject({ code: 'RESOURCE_UNKNOWN' });
  });
});
