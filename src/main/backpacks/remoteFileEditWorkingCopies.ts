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
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function digest(file: string) {
  const hash = createHash('sha256'); await pipeline(createReadStream(file), hash); return hash.digest('hex');
}

/** Receiving machine owns unsaved edits. Original download and working copy are distinct. */
export class RemoteFileEditWorkingCopies {
  constructor(private readonly directory: string) {}
  private folder(id: string) { if (!uuid.test(id)) throw new Error('Invalid local edit identity.'); return path.join(this.directory, id); }
  private store(id: string) { return new AtomicJsonStore(path.join(this.folder(id), 'edit.json'), { recoveryDir: path.join(this.folder(id), 'recovery') }); }
  async create(ownerId: string, session: EditSession, name: string, verifiedDownload: string): Promise<LocalEditCopy> {
    if (!uuid.test(ownerId) || !uuid.test(session.id) || session.phase !== 'editing' || !/^[a-f0-9]{64}$/.test(session.sourceSha256)) throw new Error('A checked edit session is required.');
    const candidate = path.extname(name); const extension = /^\.[A-Za-z0-9]{1,15}$/.test(candidate) ? candidate : '.bin';
    const record: LocalEditCopy = { id: randomUUID(), ownerId, session: structuredClone(session), name, extension, phase: 'preparing' };
    const folder = this.folder(record.id); await fs.mkdir(folder, { recursive: true });
    await this.store(record.id).save(record);
    const original = path.join(folder, 'original.bin');
    await fs.copyFile(verifiedDownload, original, fs.constants.COPYFILE_EXCL);
    if (await digest(original) !== session.sourceSha256) throw new Error('Downloaded source changed. Retained copy requires recovery.');
    await fs.copyFile(original, path.join(folder, 'working' + extension), fs.constants.COPYFILE_EXCL);
    record.phase = 'editing';
    await this.store(record.id).save(record);
    return record;
  }
  async read(id: string): Promise<LocalEditCopy> {
    // An absent or corrupt journal requires recovery; never derive state from loose files.
    const record: LocalEditCopy = JSON.parse(await fs.readFile(path.join(this.folder(id), 'edit.json'), 'utf8'));
    if (record.id !== id || !uuid.test(record.ownerId) || !uuid.test(record.session?.id ?? '') || typeof record.name !== 'string' || !/^\.[A-Za-z0-9]{1,15}$/.test(record.extension) || !['preparing','editing','saving','saved','conflict','uncertain'].includes(record.phase)) throw new Error('Local edit journal requires recovery.');
    return record;
  }
  async list(ownerId?: string) {
    return (await this.inventory(ownerId)).copies;
  }
  async inventory(ownerId?: string) {
    const ids = await fs.readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return [] as string[]; throw error; });
    const records: LocalEditCopy[] = [];
    const recovery: Array<{ id: string; name?: string; message: string }> = [];
    for (const id of ids.filter(id => uuid.test(id))) {
      try {
        const record = await this.read(id);
        if (ownerId && record.ownerId !== ownerId) continue;
        if (record.phase === 'preparing') recovery.push({ id, name: record.name, message: 'Preparation was interrupted. Retained files are available for recovery.' });
        else records.push(record);
      } catch {
        recovery.push({ id, message: 'This local edit journal needs recovery. Retained files were kept.' });
      }
    }
    return { copies: records, recovery };
  }
  async workingPath(id: string) {
    const record = await this.read(id);
    if (record.phase === 'preparing') throw new Error('Working-copy preparation requires recovery.');
    const file = path.join(this.folder(id), 'working' + record.extension);
    if (!(await fs.stat(file)).isFile()) throw new Error('Local working copy is unavailable.');
    return file;
  }
  async originalPath(id: string) {
    const record = await this.read(id); const file = path.join(this.folder(id), 'original.bin');
    if (await digest(file) !== record.session.sourceSha256) throw new Error('Retained original requires recovery.');
    return file;
  }
  async recoveryPath(id: string) {
    const folder = this.folder(id); const stats = await fs.lstat(folder);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Retained edit folder is unavailable.');
    return folder;
  }
  async retain(record: LocalEditCopy) { await this.store(record.id).save(record); }
  async prepare(id: string) {
    const record = await this.read(id);
    if (record.saveId) return record;
    const working = await this.workingPath(id);
    const expected = await digest(working);
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
