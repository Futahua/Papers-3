import * as path from 'node:path';
import { RemoteFileError, RemoteFileResources } from './remoteFileResources';
import { RemoteFileEditSessions, type EditSession } from './remoteFileEditSessions';
import { RemoteFileEditUploads } from './remoteFileEditUploads';

export interface CheckedFileEditProvider {
  inspect(source: { path: string; approvedRoot: string }): Promise<{ token: string; sha256: string }>;
  save(source: { path: string; approvedRoot: string }, workingCopy: string, expected: { token: string; sourceSha256: string; editedSha256: string }, authorize: () => void): Promise<{ savedSha256: string }>;
}

/** Gateway-facing edit owner. Provider paths come only from the approved catalog.
 * Client facts cannot replace the captured source revision or select a working path. */
export class RemoteFileEditOwner {
  fileTargets?: import('./fileTargetRegistry').TargetRegistry;
  readonly uploads: RemoteFileEditUploads;
  readonly sessions: RemoteFileEditSessions;
  private readonly catalogs = new Map<string, RemoteFileResources>();
  private readonly revoked = new Set<string>();
  private accepting = true;
  private readonly opening = new Set<Promise<unknown>>();
  constructor(directory: string, private readonly provider: CheckedFileEditProvider) {
    this.uploads = new RemoteFileEditUploads(path.join(directory, 'uploads'));
    this.sessions = new RemoteFileEditSessions(directory, session => this.save(session));
  }
  async initialize() { await this.sessions.initialize(); }
  async assignments(deviceId: string, catalog: RemoteFileResources) {
    this.attach(deviceId, catalog);
    const result = [];
    for (const assignment of this.sessions.assignmentList()) {
      try { const target = assignment.targetId && this.fileTargets ? await this.fileTargets.resolve(assignment.targetId) : { status: 'present', path: assignment.targetPath }; if (target.status !== 'present' || !target.path) continue; const entry = await catalog.ownerEntry(target.path); result.push({ id: assignment.id, editorDeviceId: assignment.editorDeviceId, name: assignment.name, active: assignment.active, mine: assignment.editorDeviceId === deviceId, entry }); } catch { /* A different grant must not disclose this target. */ }
    }
    return result;
  }
  async assign(deviceId: string, catalog: RemoteFileResources, resourceId: string, sourceVersion: string, editorDeviceId: string) {
    this.attach(deviceId, catalog);
    const source = await catalog.checkedEditSource(resourceId, sourceVersion);
    const target = await this.fileTargets?.track(source.path);
    return this.sessions.assign(editorDeviceId, source.path, source.entry.name, target?.targetId);
  }
  async stopAssignment(deviceId: string, catalog: RemoteFileResources, id: string) {
    this.attach(deviceId, catalog);
    const assignment = this.sessions.assignmentList().find(item => item.id === id);
    if (!assignment) throw Error('Editing assignment unavailable');
    const target = assignment.targetId && this.fileTargets ? await this.fileTargets.resolve(assignment.targetId) : { status: 'present', path: assignment.targetPath };
    if (!target.path) throw Error('Original file unavailable');
    await catalog.ownerEntry(target.path);
    await this.sessions.stopAssignment(id);
    return { id, active: false };
  }
  private authorize(deviceId: string) {
    if (!this.accepting || this.revoked.has(deviceId) || !this.catalogs.has(deviceId)) throw new Error('Device edit access is unavailable.');
  }
  begin(deviceId: string, catalog: RemoteFileResources, resourceId: string, sourceVersion: string) {
    const pending = this.openSession(deviceId, catalog, resourceId, sourceVersion);
    this.opening.add(pending);
    void pending.finally(() => this.opening.delete(pending)).catch(() => {});
    return pending;
  }
  private async openSession(deviceId: string, catalog: RemoteFileResources, resourceId: string, sourceVersion: string) {
    if (!this.accepting || this.revoked.has(deviceId)) throw new Error('Device edit access is unavailable.');
    this.catalogs.set(deviceId, catalog);
    const source = await catalog.checkedEditSource(resourceId, sourceVersion);
    const captured = await this.provider.inspect(source);
    // Bind the native snapshot to the catalog revision before retaining a session.
    await catalog.checkedEditSource(resourceId, sourceVersion);
    const digest = await catalog.digest(resourceId, sourceVersion);
    if (digest.sha256 !== captured.sha256) throw new RemoteFileError('VERSION_CHANGED', 'Source changed while opening the edit session.');
    this.authorize(deviceId);
    const target = await this.fileTargets?.track(source.path);
    const assignment = this.sessions.assignmentList().find(item => item.active && (item.targetId && target ? item.targetId === target.targetId : item.targetPath === source.path));
    if (assignment) this.sessions.assertAssignment(assignment.id, deviceId);
    return this.sessions.begin(deviceId, { resourceId, sourceVersion, sourceSha256: captured.sha256, nativeRevision: captured.token, assignmentId: assignment?.id, targetId: target?.targetId, originalPath: source.path, originalParts: catalog.shareParts(source.path) ?? undefined });
  }
  /** Reattach only the current approved grant after a process restart. */
  attach(deviceId: string, catalog: RemoteFileResources) {
    if (!this.accepting || this.revoked.has(deviceId)) throw new Error('Device edit access is unavailable.');
    this.catalogs.set(deviceId, catalog);
  }
  async beginUpload(deviceId: string, sessionId: string, bytes: number, sha256: string) {
    this.authorize(deviceId);
    const session = this.sessions.list(deviceId).find(item => item.id === sessionId);
    if (!session || session.phase !== 'editing') throw new Error('Edit session is unavailable for a new working copy.');
    return this.uploads.begin(deviceId, sessionId, bytes, sha256);
  }
  async commit(deviceId: string, sessionId: string, saveId: string, uploadId: string, sha256: string) {
    this.authorize(deviceId);
    return this.sessions.commit(deviceId, sessionId, saveId, sha256, uploadId);
  }
  private async save(session: Readonly<EditSession>) {
    this.authorize(session.deviceId);
    if (session.assignmentId) this.sessions.assertAssignment(session.assignmentId, session.deviceId);
    if (!session.nativeRevision || !session.uploadId || !session.editedSha256) throw new Error('A checked edit source and sealed upload are required.');
    const catalog = this.catalogs.get(session.deviceId)!;
    let source;
    if (session.targetId && this.fileTargets) {
      const target = await this.fileTargets.resolve(session.targetId);
      if (target.status !== 'present' || !target.path) throw new RemoteFileError('VERSION_CHANGED', 'Original target unavailable');
      const current = await catalog.ownerEntry(target.path);
      if ((await catalog.digest(current.id, current.version)).sha256 !== session.sourceSha256) throw new RemoteFileError('VERSION_CHANGED', 'Original changed');
      source = await catalog.checkedEditSource(current.id, current.version);
    } else source = await catalog.checkedEditSource(session.resourceId, session.sourceVersion);
    const workingCopy = await this.uploads.checkedCopy(session.deviceId, session.uploadId, session.id, session.editedSha256);
    const receipt = await this.provider.save(source, workingCopy, { token: session.nativeRevision, sourceSha256: session.sourceSha256, editedSha256: session.editedSha256 }, () => { this.authorize(session.deviceId); if (session.assignmentId) this.sessions.assertAssignment(session.assignmentId, session.deviceId); });
    const saved = await catalog.ownerEntry(source.path);
    const digest = await catalog.digest(saved.id, saved.version);
    if (receipt.savedSha256 !== session.editedSha256 || digest.sha256 !== session.editedSha256) throw new Error('Saved revision was not confirmed; retain the working copy.');
    return { savedVersion: saved.version, savedSha256: digest.sha256, savedResourceId: saved.id };
  }
  revoke(deviceId: string) {
    this.revoked.add(deviceId); this.catalogs.delete(deviceId);
    this.sessions.revoke(deviceId); this.uploads.revoke(deviceId);
  }
  async close() {
    this.accepting = false;
    await Promise.allSettled([...this.opening]);
    await Promise.all([this.sessions.close(), this.uploads.close()]);
  }
}
