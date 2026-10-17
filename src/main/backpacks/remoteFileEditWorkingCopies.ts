import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AtomicJsonStore } from '../persistence/atomicStore';
import type { EditSession } from './remoteFileEditSessions';

export interface LocalEditCopy {
  id: string; ownerId: string; session: EditSession; name: string; extension: string;
  phase: 'preparing' | 'editing' | 'saving' | 'saved' | 'conflict' | 'uncertain';
  uploadId?: string; saveId?: string; editedSha256?: string;
  editedBytes?: number;
  newerLocalEdits?: boolean;
  baseline?: string;
  workingName?: string;
  workingFolders?: string[];
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function digest(file: string) {
  const hash = createHash('sha256'); await pipeline(createReadStream(file), hash); return hash.digest('hex');
}

/** Receiving machine owns unsaved edits. Original download and working copy are distinct. */
export class RemoteFileEditWorkingCopies {
  constructor(private readonly directory: string, private readonly workingDirectory = path.join(directory, 'Working files')) {}
  workingRoot() { return this.workingDirectory; }
  private editablePath(record: LocalEditCopy) {
    if (!record.workingName) return path.join(this.folder(record.id), 'working' + record.extension);
    if (record.workingName !== path.basename(record.workingName) || /[<>:"/\\|?*\x00-\x1f]/.test(record.workingName) || ['.', '..'].includes(record.workingName)) throw Error('Invalid working filename');
    const folders = record.workingFolders ?? [];
    if (folders.some(p => !p || p === '.' || p === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(p))) throw Error('Invalid working folder');
    return path.join(this.workingDirectory, record.id, ...folders, record.workingName);
  }
  private folder(id: string) { if (!uuid.test(id)) throw new Error('Invalid local edit identity.'); return path.join(this.directory, id); }
  private store(id: string) { return new AtomicJsonStore(path.join(this.folder(id), 'edit.json'), { recoveryDir: path.join(this.folder(id), 'recovery') }); }
  async create(ownerId: string, session: EditSession, name: string, verifiedDownload: string): Promise<LocalEditCopy> {
    if (!uuid.test(ownerId) || !uuid.test(session.id) || session.phase !== 'editing' || !/^[a-f0-9]{64}$/.test(session.sourceSha256)) throw new Error('A checked edit session is required.');
    const candidate = path.extname(name); const extension = /^\.[A-Za-z0-9]{1,15}$/.test(candidate) ? candidate : '.bin';
    let workingName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 200) || 'Untitled' + extension;
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(workingName)) workingName = '_' + workingName;
    const workingFolders = (session.originalParts ?? []).slice(0,-1).map(p => p.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '_');
    const record: LocalEditCopy = { id: randomUUID(), ownerId, session: structuredClone(session), name, extension, workingName, workingFolders, phase: 'preparing' };
    const folder = this.folder(record.id); await fs.mkdir(folder, { recursive: true });
    await this.store(record.id).save(record);
    const original = path.join(folder, 'original.bin');
    await fs.copyFile(verifiedDownload, original, fs.constants.COPYFILE_EXCL);
    if (await digest(original) !== session.sourceSha256) throw new Error('Downloaded source changed. Retained copy requires recovery.');
    await fs.mkdir(path.dirname(this.editablePath(record)), { recursive: true });
    await fs.copyFile(original, this.editablePath(record), fs.constants.COPYFILE_EXCL);
    record.phase = 'editing';
    await this.store(record.id).save(record);
    return record;
  }
  async read(id: string): Promise<LocalEditCopy> {
    // An absent or corrupt journal requires recovery; never derive state from loose files.
    const record: LocalEditCopy = JSON.parse(await fs.readFile(path.join(this.folder(id), 'edit.json'), 'utf8'));
    if (record.id !== id || !uuid.test(record.ownerId) || !uuid.test(record.session?.id ?? '') || typeof record.name !== 'string' || !/^\.[A-Za-z0-9]{1,15}$/.test(record.extension) || !['preparing','editing','saving','saved','conflict','uncertain'].includes(record.phase)) throw new Error('Local edit journal requires recovery.');
    if (record.baseline && !/^[a-f0-9-]{36}\.baseline$/.test(record.baseline)) throw Error('Invalid retained baseline');
    return record;
  }
  async list(ownerId?: string, verifyChanges = true) {
    return (await this.inventory(ownerId, verifyChanges)).copies;
  }
  async inventory(ownerId?: string, verifyChanges = true) {
    const ids = await fs.readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return [] as string[]; throw error; });
    const records: LocalEditCopy[] = [];
    const recovery: Array<{ id: string; name?: string; message: string }> = [];
    for (const id of ids.filter(id => uuid.test(id))) {
      try {
        const record = await this.read(id);
        if (ownerId && record.ownerId !== ownerId) continue;
        if (record.phase === 'preparing') recovery.push({ id, name: record.name, message: 'Preparation was interrupted. Retained files are available for recovery.' });
        else {
          if (verifyChanges && record.phase === 'saved') record.newerLocalEdits = await digest(this.editablePath(record)) !== record.editedSha256;
          records.push(record);
        }
      } catch {
        recovery.push({ id, message: 'This local edit journal needs recovery. Retained files were kept.' });
      }
    }
    return { copies: records, recovery };
  }
  async workingPath(id: string) {
    const record = await this.read(id);
    if (record.phase === 'preparing') throw new Error('Working-copy preparation requires recovery.');
    const file = this.editablePath(record);
    if (!(await fs.stat(file)).isFile()) throw new Error('Local working copy is unavailable.');
    return file;
  }
  async originalPath(id: string) {
    const record = await this.read(id); const file = path.join(this.folder(id), record.baseline ?? 'original.bin');
    if (await digest(file) !== record.session.sourceSha256) throw new Error('Retained original requires recovery.');
    return file;
  }
  async recoveryPath(id: string) {
    const folder = this.folder(id); const stats = await fs.lstat(folder);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Retained edit folder is unavailable.');
    return folder;
  }
  async retain(record: LocalEditCopy) { await this.store(record.id).save(record); }
  async removeUnlinked(id: string) {
    const record = await this.read(id);
    const roots = [this.folder(id), ...(record.workingName ? [path.join(this.workingDirectory, id)] : [])];
    for (const root of roots) { const stat = await fs.lstat(root).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); if (stat?.isSymbolicLink() || stat && !stat.isDirectory()) throw Error('Working folder identity changed'); }
    // Only the checked UUID-owned folders, including editor sidecars, are removed.
    for (const root of roots.reverse()) await fs.rm(root, { recursive: true, force: true });
  }
  async nextRevision(id: string, session: EditSession) {
    const record = await this.read(id);
    if (record.phase !== 'saved' || session.sourceVersion !== record.session.savedVersion || session.sourceSha256 !== record.editedSha256 || session.assignmentId !== record.session.assignmentId) throw Error('Next editing revision differs from saved receipt');
    const baseline = session.id + '.baseline';
    await fs.copyFile(await this.saveSnapshot(id), path.join(this.folder(id), baseline), fs.constants.COPYFILE_EXCL);
    record.baseline = baseline; record.session = session; record.phase = 'editing';
    delete record.saveId; delete record.uploadId; delete record.editedSha256; delete record.editedBytes;
    await this.retain(record); return record;
  }
  async carryWorkingCopy(previousId: string, nextId: string) {
    const previous = await this.read(previousId), next = await this.read(nextId);
    if (previous.phase !== 'saved' || next.phase !== 'editing' || previous.ownerId !== next.ownerId || previous.session.resourceId !== next.session.resourceId || previous.session.savedVersion !== next.session.sourceVersion) throw new Error('The new edit session does not match the confirmed saved source.');
    const source = await this.workingPath(previousId), target = await this.workingPath(nextId);
    next.phase = 'preparing'; await this.retain(next);
    const expected = await digest(source), retained = path.join(this.folder(nextId), 'continued-' + randomUUID() + '.bin');
    await fs.copyFile(source, retained, fs.constants.COPYFILE_EXCL);
    if (await digest(retained) !== expected || await digest(source) !== expected) throw new Error('Local edits changed while continuing. Both working copies are retained.');
    const handle = await fs.open(retained, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    await fs.copyFile(retained, target);
    if (await digest(target) !== expected) throw new Error('Continued working copy needs recovery. Retained files are available.');
    const workingHandle = await fs.open(target, 'r+'); try { await workingHandle.sync(); } finally { await workingHandle.close(); }
    next.phase = 'editing'; await this.retain(next);
  }
  async prepare(id: string) {
    const record = await this.read(id);
    if (record.saveId) return record;
    const working = await this.workingPath(id);
    const expected = await digest(working);
    if (expected === record.session.sourceSha256) throw new Error('No changes were found in this working copy. Your editor may have saved a separate copy; retain that file before saving back.');
    const saveId = randomUUID(); const snapshot = path.join(this.folder(id), saveId + '.save');
    await fs.copyFile(working, snapshot, fs.constants.COPYFILE_EXCL);
    if (await digest(snapshot) !== expected || await digest(working) !== expected) throw new Error('Working copy changed while preparing. Retained copies are available; save again after editing settles.');
    const file = await fs.open(snapshot, 'r+'); try { await file.sync(); } finally { await file.close(); }
    record.saveId = saveId; record.editedSha256 = expected; record.editedBytes = (await fs.stat(snapshot)).size;
    record.phase = 'saving'; await this.retain(record); return record;
  }
  async saveSnapshot(id: string) {
    const record = await this.read(id);
    if (!uuid.test(record.saveId ?? '') || !/^[a-f0-9]{64}$/.test(record.editedSha256 ?? '') || !Number.isSafeInteger(record.editedBytes)) throw new Error('Retained save snapshot is unavailable.');
    const file = path.join(this.folder(id), record.saveId + '.save');
    if ((await fs.stat(file)).size !== record.editedBytes || await digest(file) !== record.editedSha256) throw new Error('Retained save snapshot requires recovery.');
    return file;
  }
}
