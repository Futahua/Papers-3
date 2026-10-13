import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RemoteFileResources } from '../src/main/backpacks/remoteFileResources';
import { RemoteFileEditOwner, type CheckedFileEditProvider } from '../src/main/backpacks/remoteFileEditOwner';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function* chunks(bytes: Uint8Array) { yield bytes; }
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-edit-owner-'));
  const shared = path.join(root, 'shared'); await fs.mkdir(shared);
  const original = path.join(shared, 'source.txt'); await fs.writeFile(original, 'original');
  const catalog = await RemoteFileResources.create([{ id: 'share', name: 'Fixture', directory: shared }], 'fixture-key');
  const folder = (await catalog.shares())[0]!;
  const entry = (await catalog.list(folder.id)).entries[0]!;
  let writes = 0;
  // This fixture tests owner routing, not native transaction behavior.
  const provider: CheckedFileEditProvider = {
    async inspect(source) { return { token: 'a'.repeat(64), sha256: hash(await fs.readFile(source.path)) }; },
    async save(source, upload, expected, authorize) {
      authorize(); expect(expected.token).toBe('a'.repeat(64));
      expect(source.approvedRoot).toBe(shared); expect(source.path).toBe(original);
      const bytes = await fs.readFile(upload); expect(hash(bytes)).toBe(expected.editedSha256);
      writes++; await fs.writeFile(source.path, bytes); return { savedSha256: hash(bytes) };
    },
  };
  const owner = new RemoteFileEditOwner(path.join(root, 'edits'), provider); await owner.initialize();
  return { root, catalog, entry, original, owner, provider, writes: () => writes };
}
describe('approved remote edit owner binding', () => {
  it('saves only a sealed copy bound to the captured session and retains the receipt after restart', async () => {
    const f = await fixture(); const edited = Buffer.from('edited');
    const session = await f.owner.begin('peer', f.catalog, f.entry.id, f.entry.version);
    const upload = await f.owner.beginUpload('peer', session.id, edited.length, hash(edited));
    await f.owner.uploads.append('peer', upload, 0, chunks(edited)); await f.owner.uploads.seal('peer', upload);
    const saveId = randomUUID(); expect((await f.owner.commit('peer', session.id, saveId, upload, hash(edited))).phase).toBe('saved');
    expect(await fs.readFile(f.original, 'utf8')).toBe('edited'); await f.owner.close();
    const restarted = new RemoteFileEditOwner(path.join(f.root, 'edits'), f.provider); await restarted.initialize(); restarted.attach('peer', f.catalog);
    expect((await restarted.commit('peer', session.id, saveId, upload, hash(edited))).phase).toBe('saved'); expect(f.writes()).toBe(1);
  });
  it('retains both versions after an external source change without dispatching', async () => {
    const f = await fixture(); const edited = Buffer.from('edited');
    const session = await f.owner.begin('peer', f.catalog, f.entry.id, f.entry.version);
    const upload = await f.owner.beginUpload('peer', session.id, edited.length, hash(edited));
    await f.owner.uploads.append('peer', upload, 0, chunks(edited)); await f.owner.uploads.seal('peer', upload);
    await fs.writeFile(f.original, 'external change');
    expect((await f.owner.commit('peer', session.id, randomUUID(), upload, hash(edited))).phase).toBe('conflict');
    expect(f.writes()).toBe(0); expect(await fs.readFile(f.original, 'utf8')).toBe('external change');
    expect(await fs.readFile(await f.owner.uploads.checkedCopy('peer', upload, session.id, hash(edited)))).toEqual(edited);
  });
  it('refuses cross-session working copies, unknown sessions, and revoked peers', async () => {
    const f = await fixture(); const edited = Buffer.from('edited');
    const one = await f.owner.begin('peer', f.catalog, f.entry.id, f.entry.version);
    const two = await f.owner.begin('peer', f.catalog, f.entry.id, f.entry.version);
    const upload = await f.owner.beginUpload('peer', one.id, edited.length, hash(edited));
    await f.owner.uploads.append('peer', upload, 0, chunks(edited)); await f.owner.uploads.seal('peer', upload);
    expect((await f.owner.commit('peer', two.id, randomUUID(), upload, hash(edited))).phase).toBe('uncertain'); expect(f.writes()).toBe(0);
    await expect(f.owner.beginUpload('peer', randomUUID(), 1, hash(edited))).rejects.toThrow('unavailable');
    f.owner.revoke('peer'); await expect(f.owner.commit('peer', one.id, randomUUID(), upload, hash(edited))).rejects.toThrow('unavailable');
  });
});
