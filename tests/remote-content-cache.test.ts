import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RemoteFileClient } from '../src/main/backpacks/remoteFileClient';

const day = 24 * 60 * 60 * 1000;
async function cacheWith(copies: { name: string; bytes: number; ageDays: number }[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-cache-'));
  const content = path.join(root, 'content');
  await fs.mkdir(content, { recursive: true });
  const keys: Record<string, string> = {};
  for (const copy of copies) {
    const key = createHash('sha256').update(copy.name).digest('hex');
    keys[copy.name] = key;
    const file = path.join(content, `${key}${path.extname(copy.name)}`);
    await fs.writeFile(file, Buffer.alloc(copy.bytes));
    await fs.writeFile(path.join(content, `${key}.json`), JSON.stringify({ ownerId: 'o', key, sha256: '0'.repeat(64), entry: { name: copy.name, size: copy.bytes } }));
    const when = new Date(Date.now() - copy.ageDays * day);
    await fs.utimes(file, when, when);
  }
  const client = new RemoteFileClient(root, {} as never);
  const exists = async (name: string) => fs.stat(path.join(content, `${keys[name]}${path.extname(name)}`)).then(() => true, () => false);
  return { client, exists };
}

describe('remote copy cache limit', () => {
  it('removes copies unused for 14 days and keeps recent ones', async () => {
    const { client, exists } = await cacheWith([{ name: 'old.mp4', bytes: 10, ageDays: 20 }, { name: 'new.pdf', bytes: 10, ageDays: 1 }]);
    const result = await client.pruneContentCache();
    expect(result.removed).toBe(1);
    expect(await exists('old.mp4')).toBe(false);
    expect(await exists('new.pdf')).toBe(true);
  });

  it('over the size limit, removes the least recently used first', async () => {
    const { client, exists } = await cacheWith([
      { name: 'a.bin', bytes: 400, ageDays: 3 }, { name: 'b.bin', bytes: 400, ageDays: 2 }, { name: 'c.bin', bytes: 400, ageDays: 1 },
    ]);
    const result = await client.pruneContentCache(Date.now(), 14 * day, 900);
    expect(result.bytes).toBeLessThanOrEqual(900);
    expect(await exists('a.bin')).toBe(false);
    expect(await exists('b.bin')).toBe(true);
    expect(await exists('c.bin')).toBe(true);
  });
});
