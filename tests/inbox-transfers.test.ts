import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { FileInbox } from '../src/main/backpacks/fileInbox';
import { InboxTransfers, type InboxNode } from '../src/main/backpacks/inboxTransfers';
import type { RemoteFileClient } from '../src/main/backpacks/remoteFileClient';

const owner = '417c0ac8-0000-4000-8000-000000000001';
const source = (name: string) => `\\\\papers~${owner}\\C:\\Shared\\${name}`;

async function setup(contents: Record<string, string | Error>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-inbox-'));
  const inboxDir = path.join(root, 'Papers Inbox');
  const inbox = new FileInbox(path.join(root, 'inbox.json'), inboxDir);
  await inbox.initialize();
  const cache = path.join(root, 'cache');
  await fs.mkdir(cache);
  const client = {
    snapshot: () => ({ jobs: [] }),
    cancel: () => {},
    contentDigest: async (_owner: string, entry: {name: string}) => { const value = contents[entry.name]; if (value instanceof Error) throw value; return createHash('sha256').update(value ?? '').digest('hex'); },
    materialize: async (_owner: string, entry: { name: string }) => {
      const value = contents[entry.name];
      if (value instanceof Error) throw value;
      const file = path.join(cache, randomUUID());
      await fs.writeFile(file, value ?? '');
      return file;
    },
  } as unknown as RemoteFileClient;
  const plan = async (paths: string[]): Promise<InboxNode[]> => paths.map(item => {
    const name = item.split('\\').pop()!;
    const value = contents[name];
    return { source: item, ownerId: owner, children: [],
      entry: { id: name, name, kind: 'file', size: typeof value === 'string' ? Buffer.byteLength(value) : 3, modifiedAt: 0, version: '1' } as never };
  });
  const transfers = new InboxTransfers(path.join(root, 'jobs'), inbox, client, plan);
  await transfers.initialize();
  const settle = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const job = transfers.snapshot().find(item => item.id === id)!;
      if (['completed', 'failed', 'uncertain'].includes(job.phase)) return job;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Transfer did not settle.');
  };
  return { root, inboxDir, transfers, settle };
}

describe('inbox transfers', () => {
  it('saves a device file into this computer\'s inbox and reports where it landed', async () => {
    const { inboxDir, transfers, settle } = await setup({ 'aaaaa.pdf': 'pdf bytes' });
    const id = randomUUID();
    await transfers.start(id, [source('aaaaa.pdf')]);
    const job = await settle(id);
    expect(job.phase).toBe('completed');
    expect(job.bytes).toBe(9);
    expect(job.results).toEqual([{ name: 'aaaaa.pdf', target: path.join(await fs.realpath(inboxDir), 'aaaaa.pdf'), kind: 'file' }]);
    expect(await fs.readFile(job.results[0]!.target, 'utf8')).toBe('pdf bytes');
    // No staging folder is left behind among the creator's files.
    expect(await fs.readdir(inboxDir)).toEqual(['aaaaa.pdf']);
  });

  it('never overwrites a file already in the inbox', async () => {
    const { inboxDir, transfers, settle } = await setup({ 'note.txt': 'new' });
    await fs.mkdir(inboxDir, { recursive: true });
    await fs.writeFile(path.join(inboxDir, 'note.txt'), 'old');
    const id = randomUUID();
    await transfers.start(id, [source('note.txt')]);
    const job = await settle(id);
    expect(job.results[0]!.name).toBe('note (1).txt');
    expect(await fs.readFile(path.join(inboxDir, 'note.txt'), 'utf8')).toBe('old');
  });

  it('a failed download reports the reason and publishes nothing to link', async () => {
    const { inboxDir, transfers, settle } = await setup({ 'gone.pdf': new Error('The source device is offline.') });
    const id = randomUUID();
    await transfers.start(id, [source('gone.pdf')]);
    const job = await settle(id);
    expect(job.phase).toBe('failed');
    expect(job.error).toBe('The source device is offline.');
    expect(job.results).toEqual([]);
    expect((await fs.readdir(inboxDir)).filter(name => !name.startsWith('.papers-incoming-'))).toEqual([]);
  });

  it('refuses paths that are not on a connected device and a reused request id', async () => {
    const { transfers } = await setup({ 'a.txt': 'a', 'b.txt': 'b' });
    await expect(transfers.start(randomUUID(), ['C:\\Shared\\a.txt'])).rejects.toThrow('Choose files from a connected device.');
    const id = randomUUID();
    await transfers.start(id, [source('a.txt')]);
    await expect(transfers.start(id, [source('b.txt')])).rejects.toThrow('Download request identity changed.');
  });
});
