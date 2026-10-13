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
  const inventory = await copies.inventory();
  expect(inventory.copies.map(copy => copy.id)).toContain(record.id);
  expect(inventory.recovery).toHaveLength(1);
  expect(inventory.recovery[0]?.message).toContain('interrupted');
  expect(await fs.readFile(path.join(await copies.recoveryPath(inventory.recovery[0]!.id), 'original.bin'), 'utf8')).toBe('changed');
});

it('keeps healthy edits visible beside an invalid journal without trusting loose working files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-working-invalid-'));
  const download = path.join(root, 'cached.txt'); await fs.writeFile(download, 'original');
  const session: EditSession = { id: randomUUID(), deviceId: randomUUID(), resourceId: randomUUID(), sourceVersion: 'a'.repeat(64), sourceSha256: createHash('sha256').update('original').digest('hex'), phase: 'editing' };
  const directory = path.join(root, 'edits'), copies = new RemoteFileEditWorkingCopies(directory);
  const healthy = await copies.create(randomUUID(), session, 'healthy.txt', download);
  const invalid = randomUUID(); await fs.mkdir(path.join(directory, invalid)); await fs.writeFile(path.join(directory, invalid, 'edit.json'), '{broken');
  await fs.writeFile(path.join(directory, invalid, 'working.txt'), 'retained unsaved bytes');
  const inventory = await copies.inventory();
  expect(inventory.copies.map(copy => copy.id)).toEqual([healthy.id]);
  expect(inventory.recovery[0]?.id).toBe(invalid);
  await expect(copies.workingPath(invalid)).rejects.toThrow();
  expect(await fs.readFile(path.join(await copies.recoveryPath(invalid), 'working.txt'), 'utf8')).toBe('retained unsaved bytes');
});
