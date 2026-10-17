import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AtomicJsonStore } from '../persistence/atomicStore';

export interface EditSession {
  id: string;
  deviceId: string;
  resourceId: string;
  sourceVersion: string;
  sourceSha256: string;
  nativeRevision?: string;
  uploadId?: string;
  phase: 'editing' | 'saving' | 'saved' | 'conflict' | 'uncertain';
  saveId?: string;
  editedSha256?: string;
  savedVersion?: string;
  assignmentId?: string;
  targetId?: string;
  originalPath?: string;
  originalParts?: string[];
  message?: string;
}
export interface EditSaveReceipt { savedVersion: string; savedSha256: string; savedResourceId?: string }
export interface EditAssignment { id: string; targetPath: string; targetId?: string; editorDeviceId: string; name: string; active: boolean }
type CheckedSave = (session: Readonly<EditSession>) => Promise<EditSaveReceipt>;
const hash = /^[a-f0-9]{64}$/;
const identity = /^[a-f0-9-]{36}$/;

/** Owner-side receipts. Paths and upload resolution belong to the checked file owner.
 * A crash after dispatch is uncertain, never an instruction to overwrite again. */
export class RemoteFileEditSessions {
  private readonly sessions = new Map<string, EditSession>();
  private readonly assignments = new Map<string, EditAssignment>();
  private queue: Promise<unknown> = Promise.resolve();
  private accepting = true;
  private readonly revoked = new Set<string>();
  private readonly store: AtomicJsonStore;
  constructor(private readonly directory: string, private readonly save: CheckedSave) {
    this.store = new AtomicJsonStore(path.join(directory, 'edit-sessions.json'), { recoveryDir: path.join(directory, 'recovery') });
  }
  async initialize(): Promise<void> {
    let raw: { sessions: EditSession[]; assignments?: EditAssignment[] };
    try { raw = JSON.parse(await fs.readFile(path.join(this.directory, 'edit-sessions.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await fs.access(this.store.backupPath); }
      catch (backupError) { if ((backupError as NodeJS.ErrnoException).code === 'ENOENT') return; throw backupError; }
      throw new Error('Edit session journal requires explicit recovery.');
    }
    if (!Array.isArray(raw.sessions)) throw new Error('Invalid edit session journal.');
    for (const assignment of raw.assignments ?? []) {
      if (!identity.test(assignment.id) || typeof assignment.targetPath !== 'string' || !assignment.editorDeviceId || typeof assignment.active !== 'boolean' || typeof assignment.name !== 'string') throw Error('Invalid editing assignment journal');
      this.assignments.set(assignment.id, assignment);
    }
    for (const session of raw.sessions) {
      if (!identity.test(session.id) || !session.deviceId || !identity.test(session.resourceId) || !hash.test(session.sourceVersion) || !hash.test(session.sourceSha256) || !['editing','saving','saved','conflict','uncertain'].includes(session.phase) || this.sessions.has(session.id)) throw new Error('Invalid edit session journal.');
      if (session.phase !== 'editing' && (!identity.test(session.saveId ?? '') || !hash.test(session.editedSha256 ?? ''))) throw new Error('Invalid save receipt.');
      if (session.phase === 'saved' && !hash.test(session.savedVersion ?? '')) throw new Error('Invalid saved revision.');
      if ((session.nativeRevision !== undefined && !hash.test(session.nativeRevision)) || (session.uploadId !== undefined && !identity.test(session.uploadId))) throw new Error('Invalid edit provider binding.');
      if (session.phase === 'saving') {
        session.phase = 'uncertain';
        session.message = 'Saving was interrupted. Both copies are retained; inspect the owner before starting another save.';
      }
      this.sessions.set(session.id, session);
    }
    await this.persist();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private persist() { return this.store.save({ sessions: [...this.sessions.values()], assignments: [...this.assignments.values()] }); }
  assignmentList() { return structuredClone([...this.assignments.values()]); }
  assertAssignment(id: string, deviceId: string) {
    const assignment = this.assignments.get(id);
    if (!assignment?.active || assignment.editorDeviceId !== deviceId) throw Error('Editing assignment stopped or changed. Your working copy is retained.');
  }
  assign(editorDeviceId: string, targetPath: string, name: string, targetId?: string) {
    return this.serial(async () => {
      this.available(editorDeviceId);
      const before = structuredClone([...this.assignments.values()]);
      for (const previous of this.assignments.values()) if (previous.targetPath === targetPath || (targetId && previous.targetId === targetId)) previous.active = false;
      const assignment: EditAssignment = { id: randomUUID(), targetPath, targetId, editorDeviceId, name, active: true };
      this.assignments.set(assignment.id, assignment);
      try { await this.persist(); } catch (error) { this.assignments.clear(); for (const item of before) this.assignments.set(item.id, item); throw error; }
      return structuredClone(assignment);
    });
  }
  stopAssignment(id: string) {
    return this.serial(async () => {
      const assignment = this.assignments.get(id); if (!assignment) throw Error('Editing assignment unavailable');
      const previous = assignment.active; assignment.active = false;
      try { await this.persist(); } catch (error) { assignment.active = previous; throw error; }
      return structuredClone(assignment);
    });
  }
  private available(deviceId: string) {
    if (!this.accepting || this.revoked.has(deviceId)) throw new Error('Device access is unavailable.');
  }
  list(deviceId: string): EditSession[] {
    return structuredClone([...this.sessions.values()].filter(session => session.deviceId === deviceId));
  }
  begin(deviceId: string, source: Pick<EditSession, 'resourceId' | 'sourceVersion' | 'sourceSha256' | 'nativeRevision' | 'assignmentId' | 'targetId' | 'originalPath' | 'originalParts'>): Promise<EditSession> {
    return this.serial(async () => {
      this.available(deviceId);
      if (!deviceId || !identity.test(source.resourceId) || !hash.test(source.sourceVersion) || !hash.test(source.sourceSha256)) throw new Error('A checked source revision is required.');
      const session: EditSession = { resourceId: source.resourceId, sourceVersion: source.sourceVersion, sourceSha256: source.sourceSha256, id: randomUUID(), deviceId, phase: 'editing' };
      if (source.assignmentId) { this.assertAssignment(source.assignmentId, deviceId); session.assignmentId = source.assignmentId; }
      if (source.targetId) session.targetId = source.targetId;
      if (source.originalPath) session.originalPath = source.originalPath;
      if (source.originalParts) session.originalParts = [...source.originalParts];
      if (source.nativeRevision !== undefined) {
        if (!hash.test(source.nativeRevision)) throw new Error('Invalid native source revision.');
        session.nativeRevision = source.nativeRevision;
      }
      this.sessions.set(session.id, session);
      try { await this.persist(); } catch (error) { this.sessions.delete(session.id); throw error; }
      return structuredClone(session);
    });
  }
  commit(deviceId: string, id: string, saveId: string, editedSha256: string, uploadId?: string): Promise<EditSession> {
    return this.serial(async () => {
      this.available(deviceId);
      const session = this.sessions.get(id);
      if (!session || session.deviceId !== deviceId) throw new Error('Edit session is unavailable.');
      if (!identity.test(saveId) || !hash.test(editedSha256)) throw new Error('A save identity and verified working copy are required.');
      if (uploadId !== undefined && !identity.test(uploadId)) throw new Error('Invalid working-copy identity.');
      if (session.saveId) {
        if (session.saveId !== saveId || session.editedSha256 !== editedSha256 || session.uploadId !== uploadId) throw new Error('This session already has a save receipt. Retain the working copy and inspect its result.');
        return structuredClone(session);
      }
      if (session.assignmentId) this.assertAssignment(session.assignmentId, deviceId);
      const original = structuredClone(session);
      Object.assign(session, { saveId, editedSha256, phase: 'saving' });
      if (uploadId !== undefined) session.uploadId = uploadId;
      try { await this.persist(); } catch (error) { this.sessions.set(id, original); throw error; }
      try {
        // The injected owner must check authorization again immediately before commit.
        this.available(deviceId);
        const receipt = await this.save(Object.freeze(structuredClone(session)));
        if (!hash.test(receipt.savedVersion) || receipt.savedSha256 !== editedSha256) throw new Error('The owner did not confirm the saved revision.');
        session.phase = 'saved';
        session.savedVersion = receipt.savedVersion;
        if (receipt.savedResourceId) session.resourceId = receipt.savedResourceId;
      } catch (error) {
        const code = (error as { code?: string }).code;
        session.phase = code === 'VERSION_CHANGED' ? 'conflict' : 'uncertain';
        session.message = code === 'VERSION_CHANGED' ? 'The source changed. Original and working copy are retained.' : 'Save completion is unconfirmed. Retain both copies and inspect the owner before retrying.';
      }
      // Failure here leaves durable phase=saving; restart correctly reports uncertainty.
      await this.persist();
      return structuredClone(session);
    });
  }
  revoke(deviceId: string) { this.revoked.add(deviceId); }
  async close() { this.accepting = false; await this.queue; }
}
