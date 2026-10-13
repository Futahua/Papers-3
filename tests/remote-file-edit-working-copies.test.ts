import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RemoteFileEditWorkingCopies } from '../src/main/backpacks/remoteFileEditWorkingCopies';
import type { EditSession } from '../src/main/backpacks/remoteFileEditSessions';

it('keeps local edits independent of the retained original and download cache across restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-working-copy-'));
  const download = path.join(root, 'cached.txt'); await fs.writeFile(download, 'original');
  const session: EditSession = { id: randomUUID(), deviceId: randomUUID(), resourceId: randomUUID(), sourceVersion: 'a'.repeat(64), sourceSha256: createHash('sha256').update('original').digest('hex'), phase: 'editing' };
  const owner = randomUUID(); const directory = path.join(root, 'edits');
  const copies = new RemoteFileEditWorkingCopies(directory);
  const record = await copies.create(owner, session, 'document.txt', download);
  await fs.writeFile(await copies.workingPath(record.id), 'unsaved local edit');
  expect(await fs.readFile(download, 'utf8')).toBe('original');
  expect(await fs.readFile(await copies.originalPath(record.id), 'utf8')).toBe('original');
  const restarted = new RemoteFileEditWorkingCopies(directory);
  expect((await restarted.list(owner))[0]).toMatchObject({ id: record.id, phase: 'editing' });
  expect(await fs.readFile(await restarted.workingPath(record.id), 'utf8')).toBe('unsaved local edit');
  expect(await restarted.list(randomUUID())).toEqual([]);
  await expect(restarted.workingPath('../cached.txt')).rejects.toThrow('identity');
});

it('refuses mismatched downloaded bytes and detects damaged retained originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-working-integrity-'));
  const download = path.join(root, 'cached.txt'); await fs.writeFile(download, 'original');
  const session: EditSession = { id: randomUUID(), deviceId: randomUUID(), resourceId: randomUUID(), sourceVersion: 'a'.repeat(64), sourceSha256: createHash('sha256').update('original').digest('hex'), phase: 'editing' };
  const copies = new RemoteFileEditWorkingCopies(path.join(root, 'edits'));
  const record = await copies.create(randomUUID(), session, 'document.txt', download);
  const original = await copies.originalPath(record.id); await fs.writeFile(original, 'damaged');
  await expect(copies.originalPath(record.id)).rejects.toThrow('recovery');
  await fs.writeFile(download, 'changed');
  await expect(copies.create(randomUUID(), session, 'document.txt', download)).rejects.toThrow('changed');
  expect(await fs.readFile(download, 'utf8')).toBe('changed');
});
