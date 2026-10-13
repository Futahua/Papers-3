import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RemoteFileEditUploads } from '../src/main/backpacks/remoteFileEditUploads';
const bytes = Buffer.from('generated edited content');
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
async function* chunks(...values: Uint8Array[]) { yield* values; }
async function fixture() { return fs.mkdtemp(path.join(os.tmpdir(), 'papers-edit-uploads-')); }
describe('remote edit upload staging', () => {
  it('resumes a retained prefix after restart and seals only exact verified bytes', async () => {
    const root = await fixture(); const session = randomUUID();
    const uploads = new RemoteFileEditUploads(root);
    const id = await uploads.begin('peer', session, bytes.length, digest(bytes));
    await uploads.append('peer', id, 0, chunks(bytes.subarray(0, 5))); await uploads.close();
    const restarted = new RemoteFileEditUploads(root);
    expect(await restarted.status('peer', id)).toMatchObject({ receivedBytes: 5, prefixSha256: digest(bytes.subarray(0, 5)), complete: false });
    await restarted.append('peer', id, 5, chunks(bytes.subarray(5))); await restarted.seal('peer', id);
    const file = await restarted.checkedCopy('peer', id, session, digest(bytes));
    expect(await fs.readFile(file)).toEqual(bytes);
    await expect(restarted.append('peer', id, bytes.length, chunks())).rejects.toThrow('sealed');
    await expect(restarted.checkedCopy('other', id, session, digest(bytes))).rejects.toThrow('unavailable');
    await expect(restarted.checkedCopy('peer', id, randomUUID(), digest(bytes))).rejects.toThrow('session');
  });
  it('rejects stale offsets without truncating confirmed content and undoes an interrupted chunk', async () => {
    const root = await fixture(); const uploads = new RemoteFileEditUploads(root);
    const id = await uploads.begin('peer', randomUUID(), bytes.length, digest(bytes));
    await uploads.append('peer', id, 0, chunks(bytes.subarray(0, 5)));
    await expect(uploads.append('peer', id, 0, chunks(bytes))).rejects.toThrow('offset');
    expect((await uploads.status('peer', id)).receivedBytes).toBe(5);
    async function* broken() { yield bytes.subarray(5, 8); throw new Error('connection lost'); }
    await expect(uploads.append('peer', id, 5, broken())).rejects.toThrow('connection lost');
    expect(await uploads.status('peer', id)).toMatchObject({ receivedBytes: 5, prefixSha256: digest(bytes.subarray(0, 5)) });
  });
  it('refuses incomplete or corrupt content while retaining bytes and isolates revocation', async () => {
    const root = await fixture(); const uploads = new RemoteFileEditUploads(root);
    const id = await uploads.begin('peer', randomUUID(), bytes.length, digest(bytes));
    await expect(uploads.seal('peer', id)).rejects.toThrow('incomplete');
    const corrupt = Buffer.alloc(bytes.length, 42);
    await uploads.append('peer', id, 0, chunks(corrupt));
    await expect(uploads.seal('peer', id)).rejects.toThrow('verification');
    expect((await uploads.status('peer', id)).prefixSha256).toBe(digest(corrupt));
    uploads.revoke('peer'); await expect(uploads.status('peer', id)).rejects.toThrow('unavailable');
  });
  it('bounds chunks, rolls back failed writes, and supports an empty working copy', async () => {
    const root = await fixture(); const uploads = new RemoteFileEditUploads(root, 100, 4);
    const id = await uploads.begin('peer', randomUUID(), bytes.length, digest(bytes));
    await expect(uploads.append('peer', id, 0, chunks(bytes.subarray(0, 3), bytes.subarray(3, 5)))).rejects.toThrow('limit');
    expect((await uploads.status('peer', id)).receivedBytes).toBe(0);
    const empty = await uploads.begin('peer', randomUUID(), 0, digest(Buffer.alloc(0)));
    await uploads.seal('peer', empty); expect((await uploads.status('peer', empty)).complete).toBe(true);
  });
});
