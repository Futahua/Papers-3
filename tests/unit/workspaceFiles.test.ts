import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceFiles } from '../../src/main/backpacks/workspaceFiles';
const roots: string[] = [];
afterEach(async () => { for (const directory of roots.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-workspace-')); roots.push(directory); return { directory, owner: new WorkspaceFiles(path.join(directory, 'managed')) }; }
const file = { workspaceId: 'workspace-one', entryId: 'entry-one', name: 'drawing.dwg' };
it('isolates cached snapshots, notices journal replacement and keeps durable CAS across owners', async () => {
  const { owner } = await fixture(), other = new WorkspaceFiles(owner.root);
  await owner.call('project', { operation: 'journal-save', state: { value: 'one' }, revision: 'absent' });
  const first = await owner.call('project', { operation: 'journal-load' });
  (first.state as { value: string }).value = 'mutated caller';
  expect((await owner.call('project', { operation: 'journal-load' })).state).toEqual({ value: 'one' });
  await other.call('project', { operation: 'journal-save', state: { value: 'two' }, revision: first.revision });
  expect((await owner.call('project', { operation: 'journal-load' })).state).toEqual({ value: 'two' });
  expect((await owner.call('project', { operation: 'journal-save', state: { value: 'old' }, revision: first.revision })).code).toBe('STALE_REVISION');
});
it('imports an independent copy, detects external edits and preserves immutable history across restart', async () => {
  const { directory, owner } = await fixture(), original = path.join(directory, 'original.dwg'); await fs.writeFile(original, 'original');
  const imported = await owner.call('project', { operation: 'import', ...file, path: original });
  expect(imported.path).not.toBe(original); await fs.writeFile(String(imported.path), 'offline edit');
  const edited = await new WorkspaceFiles(owner.root).call('project', { operation: 'capture', ...file });
  expect(edited.hash).not.toBe(imported.hash); expect(await fs.readFile(original, 'utf8')).toBe('original');
  expect((await owner.call('project', { operation: 'content-check', hash: imported.hash })).available).toBe(true);
});
it('refuses publication over an unrecorded local edit, then bins and restores a checked copy', async () => {
  const { directory, owner } = await fixture(), original = path.join(directory, 'original.dwg'); await fs.writeFile(original, 'one');
  const imported = await owner.call('project', { operation: 'import', ...file, path: original });
  await owner.call('project', { operation: 'publish', ...file, hash: imported.hash, versionId: 'v1' });
  await fs.writeFile(String(imported.path), 'unsent');
  const refused = await owner.call('project', { operation: 'delete', ...file, versionId: 'd1' }); expect(refused.ok).toBe(false); expect(refused.localChange).toBeDefined();
  const changed = await owner.call('project', { operation: 'capture', ...file });
  await owner.call('project', { operation: 'publish', ...file, hash: changed.hash, versionId: 'v2' });
  expect((await owner.call('project', { operation: 'delete', ...file, versionId: 'd2' })).ok).toBe(true);
  expect((await owner.call('project', { operation: 'path', ...file })).available).toBe(false);
  const restored = await owner.call('project', { operation: 'publish', ...file, hash: changed.hash, versionId: 'v3' }); expect(await fs.readFile(String(restored.path), 'utf8')).toBe('unsent');
});
it('commits records and stamps in one checked journal, rejects stale saves and isolates projects', async () => {
  const { owner } = await fixture(), saved = { records: ['one'], stamps: ['human'], vv: { phone: 1 } };
  expect((await owner.call('project', { operation: 'journal-save', state: saved, revision: 'absent' })).ok).toBe(true);
  expect((await owner.call('project', { operation: 'journal-save', state: { records: [] }, revision: 'absent' })).ok).toBe(false);
  expect((await new WorkspaceFiles(owner.root).call('project', { operation: 'journal-load' })).state).toEqual(saved);
  expect((await owner.call('another-project', { operation: 'journal-load' })).state).toBe(null);
});
it('rejects entry path traversal and non-portable names', async () => {
  const { owner } = await fixture();
  await expect(owner.call('project', { operation: 'path', ...file, entryId: '../escape' })).rejects.toThrow();
  await expect(owner.call('project', { operation: 'path', ...file, name: 'CON' })).rejects.toThrow();
});
it('recovers an interrupted import and publication from their durable intent', async () => {
  const { directory, owner } = await fixture(), original = path.join(directory, 'original.dwg'); await fs.writeFile(original, 'retained');
  const imported = await owner.call('project', { operation: 'import', ...file, path: original });
  const binding = path.join(path.dirname(String(imported.path)), '.binding.json');
  await fs.unlink(String(imported.path));
  await fs.writeFile(binding, JSON.stringify({ name: file.name, hash: null, versionId: null, pending: { hash: imported.hash, versionId: null } }));
  const restarted = new WorkspaceFiles(owner.root), recovered = await restarted.call('project', { operation: 'path', ...file });
  expect(recovered.available).toBe(true); expect(await fs.readFile(String(recovered.path), 'utf8')).toBe('retained');
  await fs.writeFile(binding, JSON.stringify({ name: file.name, hash: null, versionId: null, pending: { hash: imported.hash, versionId: 'v-recovered' } }));
  expect((await new WorkspaceFiles(owner.root).call('project', { operation: 'path', ...file })).versionId).toBe('v-recovered');
});
it('rechecks modified immutable content, retains corrupt bytes and permits a verified retry', async () => {
  const { directory, owner } = await fixture(), original = path.join(directory, 'original.dwg'); await fs.writeFile(original, 'verified');
  const imported = await owner.call('project', { operation: 'import', ...file, path: original });
  const block = path.join(owner.root, 'content', String(imported.hash));
  expect((await owner.call('project', { operation: 'content-check', hash: imported.hash })).available).toBe(true);
  await fs.writeFile(block, 'damaged');
  expect((await owner.call('project', { operation: 'content-check', hash: imported.hash })).available).toBe(false);
  expect(await fs.readdir(path.join(owner.root, 'recovery'))).toHaveLength(1);
  await new WorkspaceFiles(owner.root).call('project', { operation: 'capture', ...file });
  expect((await owner.call('project', { operation: 'content-check', hash: imported.hash })).available).toBe(true);
});
it('tidies duplicate content copies left by simultaneous pushes, never deleting unverified bytes', async () => {
  const { directory, owner } = await fixture(), original = path.join(directory, 'original.dwg'); await fs.writeFile(original, 'pushed twice');
  const imported = await owner.call('project', { operation: 'import', ...file, path: original });
  const content = path.join(owner.root, 'content'), hash = String(imported.hash);
  // A second push of the same bytes landed beside the original.
  await fs.copyFile(path.join(content, hash), path.join(content, hash + ' (2)'));
  // Another device's content arrived only as a copy.
  const otherBytes = 'only the copy arrived', otherHash = createHash('sha256').update(otherBytes).digest('hex');
  await fs.writeFile(path.join(content, otherHash + ' (2)'), otherBytes);
  // A copy whose bytes do not match its name.
  const wrongHash = createHash('sha256').update('expected').digest('hex');
  await fs.writeFile(path.join(content, wrongHash + ' (3)'), 'damaged');
  expect(await owner.call('project', { operation: 'content-tidy' })).toEqual({ adopted: 1, removed: 1, quarantined: 1 });
  expect((await fs.readdir(content)).filter(name => !name.startsWith('.')).sort()).toEqual([hash, otherHash].sort());
  expect((await owner.call('project', { operation: 'content-check', hash: otherHash })).available).toBe(true);
  expect(await fs.readdir(path.join(owner.root, 'recovery'))).toHaveLength(1);
});
