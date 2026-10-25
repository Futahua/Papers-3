import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RemoteFileEditWorkingCopies } from '../src/main/backpacks/remoteFileEditWorkingCopies';
import type { EditSession } from '../src/main/backpacks/remoteFileEditSessions';

it('advances an assigned revision without changing the path open in an editor or discarding newer edits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-continuous-edit-'));
  try {
    const download = path.join(root, 'cached.txt'); await fs.writeFile(download, 'original');
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const session: EditSession = { id: randomUUID(), assignmentId: randomUUID(), deviceId: randomUUID(), resourceId: randomUUID(), sourceVersion: 'a'.repeat(64), sourceSha256: sha('original'), phase: 'editing' };
    const copies = new RemoteFileEditWorkingCopies(path.join(root, 'edits')), copy = await copies.create(randomUUID(), session, 'file.txt', download), working = await copies.workingPath(copy.id);
    await fs.writeFile(working, 'first save'); const saved = await copies.prepare(copy.id); saved.phase = 'saved'; saved.session = { ...session, phase: 'saved', savedVersion: 'b'.repeat(64) }; await copies.retain(saved);
    await fs.writeFile(working, 'newer edit during upload');
    await copies.nextRevision(copy.id, { ...session, id: randomUUID(), sourceVersion: 'b'.repeat(64), sourceSha256: sha('first save') });
    expect(await copies.workingPath(copy.id)).toBe(working); expect(await fs.readFile(working, 'utf8')).toBe('newer edit during upload');
    expect(await fs.readFile(await copies.originalPath(copy.id), 'utf8')).toBe('first save');
    expect((await copies.prepare(copy.id)).editedSha256).toBe(sha('newer edit during upload'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('keeps original location metadata, mirrors folders with the real filename, and deletes only its copy on unlink', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'papers-edit-location-'));
 try {
  const original=path.join(root,'owner.txt');await fs.writeFile(original,'owner bytes');
  const session:EditSession={id:randomUUID(),deviceId:randomUUID(),resourceId:randomUUID(),phase:'editing',sourceVersion:'a'.repeat(64),sourceSha256:createHash('sha256').update('owner bytes').digest('hex'),originalPath:'D:\\Plans\\House\\drawing.dwg',originalParts:['D:','Plans','House','drawing.dwg']};
  const workingRoot=path.join(root,'Working files'),copies=new RemoteFileEditWorkingCopies(path.join(root,'journals'),workingRoot);
  const copy=await copies.create(randomUUID(),session,'drawing.dwg',original),working=await copies.workingPath(copy.id);
  expect(working).toBe(path.join(workingRoot,copy.id,'D_','Plans','House','drawing.dwg'));
  expect((await copies.read(copy.id)).session.originalPath).toBe(session.originalPath);
  await fs.writeFile(path.join(path.dirname(working),'drawing.dwl'),'editor sidecar');
  await copies.removeUnlinked(copy.id);await expect(fs.stat(path.join(workingRoot,copy.id))).rejects.toMatchObject({code:'ENOENT'});
  expect(await fs.readFile(original,'utf8')).toBe('owner bytes');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

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

it('refuses an unchanged copy and retains the exact prepared edit when later local editing continues', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-working-save-'));
  const download = path.join(root, 'cached.txt'); await fs.writeFile(download, 'original');
  const session: EditSession = { id: randomUUID(), deviceId: randomUUID(), resourceId: randomUUID(), sourceVersion: 'a'.repeat(64), sourceSha256: createHash('sha256').update('original').digest('hex'), phase: 'editing' };
  const copies = new RemoteFileEditWorkingCopies(path.join(root, 'edits'));
  const record = await copies.create(randomUUID(), session, 'document.txt', download);
  await expect(copies.prepare(record.id)).rejects.toThrow('No changes');
  expect((await copies.read(record.id)).saveId).toBeUndefined();
  await fs.writeFile(await copies.workingPath(record.id), 'first edit');
  const prepared = await copies.prepare(record.id);
  await fs.writeFile(await copies.workingPath(record.id), 'later unsaved edit');
  expect((await copies.prepare(record.id)).saveId).toBe(prepared.saveId);
  expect(await fs.readFile(await copies.saveSnapshot(record.id), 'utf8')).toBe('first edit');
  expect(await fs.readFile(await copies.workingPath(record.id), 'utf8')).toBe('later unsaved edit');
  prepared.phase = 'saved'; await copies.retain(prepared);
  expect((await copies.list())[0]?.newerLocalEdits).toBe(true);
  await fs.writeFile(await copies.workingPath(record.id), 'first edit');
  expect((await copies.list())[0]?.newerLocalEdits).toBe(false);
});
