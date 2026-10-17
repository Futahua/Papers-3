import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AtomicJsonStore } from '../persistence/atomicStore';
import type { RemoteFileEntry } from './remoteFileResources';
import { RemoteFileOutbox } from './remoteFileOutbox';
import { RemoteFileEditWorkingCopies } from './remoteFileEditWorkingCopies';
import { uploadWithTus } from './remoteTusClient';
import { watch, type FSWatcher } from 'chokidar';
import * as os from 'node:os';
import { UsbPeerTransport } from './usbPeerTransport';

interface Connection { id: string; name: string; address: string; secret: string; deviceId: string; kind?: 'phone'; legacyPeerId?: string }
interface SecretBox { seal: (value: string) => string; open: (value: string) => string }
export interface RemoteDownloadJob { id: string; ownerId: string; entry: RemoteFileEntry; phase: 'queued' | 'transferring' | 'verifying' | 'completed' | 'failed'; bytes: number; error?: string; scope?:string }
interface CachedFile { ownerId: string; entry: RemoteFileEntry; sha256: string; key: string }
/** Preview/offline copies of other devices' files: unused for this long, or past this size, they go. */
export const CONTENT_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CONTENT_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
function extension(name: string): string { const ext = path.extname(name); return /^\.[A-Za-z0-9]{1,15}$/.test(ext) ? ext : '.bin'; }
function address(value: string, allowLoopback: boolean): string {
  const url = new URL(value);
  const octets = url.hostname.split('.').map(Number);
  const privatePeer = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
  if (url.protocol !== 'http:' || (!privatePeer && !(allowLoopback && url.hostname === '127.0.0.1')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the private Tailscale address shown by the owner.');
  return url.origin;
}
function entry(value: unknown): RemoteFileEntry {
  const candidate = value as RemoteFileEntry;
  if (!candidate || !/^[a-f0-9-]{36}$/.test(candidate.id) || typeof candidate.name !== 'string' || !['file', 'folder'].includes(candidate.kind) || !Number.isSafeInteger(candidate.size) || candidate.size < 0 || !Number.isFinite(candidate.modifiedAt) || !/^[a-f0-9]{64}$/.test(candidate.version)) throw new Error('Invalid remote file metadata.');
  return candidate;
}

/** Receiver owns connections and transfer bytes; AYG chooses pins and presentation. */
export class RemoteFileClient {
  private usb: UsbPeerTransport | null = null;
  enableUsb(localAddress:()=>string|null) {
    if(this.usb)return;
    this.usb=new UsbPeerTransport(()=>this.connections.filter(peer=>peer.kind==='phone').map(peer=>({id:peer.id,address:peer.address,token:this.secrets.open(peer.secret)})),localAddress);
    this.usb.start();
  }
  private transportFetch(input:string,options?:RequestInit) {return fetch(this.usb?.address(input)??input,options);}
  private connections: Connection[] = [];
  private readonly ownerResponses = new Map<string, number>();
  private readonly jobs = new Map<string, RemoteDownloadJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly transfers = new Map<string, Promise<void>>();
  private readonly store: AtomicJsonStore;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private readonly outbox: RemoteFileOutbox;
  private readonly editCopies: RemoteFileEditWorkingCopies;
  private readonly editOpenings = new Set<Promise<unknown>>();
  private closing = false;
  onOwnerChanged: ((ownerId: string) => void) | null = null;
  private readonly eventStreams = new Map<string, AbortController>();
  private readonly editSaves = new Map<string, Promise<unknown>>();
  private assignmentTimer?: ReturnType<typeof setInterval>;
  private assignmentPolling = false;
  private readonly editWatchers = new Map<string, FSWatcher>();
  private readonly automaticSaves = new Map<string, Promise<void>>();
  private readonly editGenerations = new Map<string, string>();
  private readonly dirtyEdits = new Set<string>();
  onAssignedEdit?: (target: string) => Promise<void>;
  constructor(private readonly directory: string, private readonly secrets: SecretBox, private readonly allowLoopback = false, workingDirectory?: string) {
    this.store = new AtomicJsonStore(path.join(directory, 'connections.json'), { recoveryDir: path.join(directory, 'recovery') });
    this.outbox = new RemoteFileOutbox(directory);
    this.editCopies = new RemoteFileEditWorkingCopies(path.join(directory, 'edits'), workingDirectory);
    setTimeout(() => { void this.pruneContentCache().catch(() => {}); }, 60_000).unref?.();
  }
  async initialize(): Promise<void> {
    await this.outbox.initialize();
    const report = await this.store.load<{ version: 1; connections: Connection[] }>();
    if (report.value) {
      if (report.value.version !== 1 || !Array.isArray(report.value.connections)) throw new Error('Remote connection store needs recovery.');
      for (const connection of report.value.connections) {
        address(connection.address, this.allowLoopback);
        if (!/^[a-f0-9-]{36}$/.test(connection.id) || typeof connection.name !== 'string' || typeof connection.secret !== 'string') throw new Error('Remote connection store needs recovery.');
      }
      this.connections = report.value.connections;
      for (const connection of this.connections) if (connection.kind === 'phone') this.watchPhone(connection);
    }
    this.assignmentTimer = setInterval(() => { void this.pollAssignments(); }, 5000); this.assignmentTimer.unref?.();
  }
  async editingAssignments(ownerId: string) {
    const copies = await this.editCopies.list(ownerId, false);
    let status;
    try { status = await (await this.request(ownerId, '/v1/files/edits/assignments')).json(); }
    catch (error) { if (!copies.some(c=>c.session.assignmentId)) throw error;
      const deviceId = this.connection(ownerId).deviceId;
      status = {offline:true,editors:[{id:deviceId,name:os.hostname()}],assignments:copies.filter(c=>c.session.assignmentId).map(c=>({id:c.session.assignmentId,active:true,mine:true,editorDeviceId:deviceId,entry:{id:c.session.resourceId,name:c.name},offline:true}))};
    }
    status.localCopies = (await this.editCopies.list(ownerId, false)).filter(copy => copy.session.assignmentId).map(copy => ({ id: copy.id, assignmentId: copy.session.assignmentId, phase: copy.phase }));
    return status;
  }
  async workingFolder() { const folder = this.editCopies.workingRoot(); await fs.mkdir(folder,{recursive:true}); return folder; }
  async assignEditing(ownerId: string, raw: unknown, editorDeviceId: string) {
    const file = entry(raw);
    return (await (await this.request(ownerId, '/v1/files/edits/assignments', {}, undefined, { resourceId: file.id, sourceVersion: file.version, editorDeviceId })).json()).assignment;
  }
  async stopEditing(ownerId: string, id: string) {
    return (await (await this.request(ownerId, '/v1/files/edits/assignments', {}, undefined, { action: 'stop', id })).json()).assignment;
  }
  private async pollAssignments() {
    if (this.closing || this.assignmentPolling) return; this.assignmentPolling = true;
    try {
      const watched = new Set<string>();
      for (const connection of this.connections) {
        if (this.closing) break;
        try {
          const status = await this.editingAssignments(connection.id);
          const copies = await this.editCopies.list(connection.id, false);
          for (const copy of copies) if (copy.session.assignmentId && (status.assignments ?? []).some((a: {id:string;active:boolean}) => a.id === copy.session.assignmentId && !a.active)) {
            await this.editWatchers.get(copy.id)?.close(); this.editWatchers.delete(copy.id);
            try {
              await this.automaticSaves.get(copy.id); await this.editSaves.get(copy.id);
              await this.editCopies.removeUnlinked(copy.id);
            } catch {
              // An editor may still hold the stopped folder. Retry cleanup next poll;
              // it must not prevent a different, active assignment from preparing.
            } finally {
              this.editGenerations.delete(copy.id); this.dirtyEdits.delete(copy.id);
            }
          }
          if (status.offline) { for(const copy of copies)watched.add(copy.id); continue; }
          for (const assignment of status.assignments ?? []) {
            if (!assignment.active || !assignment.mine) continue;
            let copy = copies.find(item => item.session.assignmentId === assignment.id);
            if (!copy) {
              copy = await this.beginEdit(connection.id, assignment.entry);
              if (copy.session.assignmentId !== assignment.id) continue;
              let parent: string|undefined;
              for (const part of copy.session.originalParts?.slice(0,-1) ?? []) {
                const listing = await this.browse(connection.id,parent);
                const entry = listing.entries.find((e:RemoteFileEntry)=>e.name.toLowerCase()===part.toLowerCase());
                if(!entry)break; parent=entry.id;
              }
              if(parent)await this.browse(connection.id,parent);
              // Assignment prepares a copy; opening an editor is a separate user action.
            }
            watched.add(copy.id);
            if (!this.editWatchers.has(copy.id)) {
              const id = copy.id, watcher = watch(await this.editCopies.workingPath(id), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 } });
              watcher.on('change', () => this.automaticSave(id, true)); watcher.on('add', () => this.automaticSave(id, true)); watcher.on('error', () => {});
              this.editWatchers.set(id, watcher);
            }
            this.automaticSave(copy.id);
          }
        } catch { // An unreachable owner is unknown, never a reason to discard a copy or journal.
          for (const copy of await this.editCopies.list(connection.id, false).catch(() => [])) if (copy.session.assignmentId) watched.add(copy.id);
        }
      }
      for (const [id, watcher] of this.editWatchers) if (!watched.has(id)) { await watcher.close(); this.editWatchers.delete(id); }
    } finally { this.assignmentPolling = false; }
  }
  private automaticSave(id: string, changed = false) {
    if (changed) this.dirtyEdits.add(id);
    if (this.closing || this.automaticSaves.has(id)) return;
    const pending = (async () => {
      let copy = await this.editCopies.read(id);
      if (copy.phase === 'conflict' || !copy.session.assignmentId) return;
      const stat = await fs.stat(await this.editCopies.workingPath(id));
      const generation = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
      if (copy.phase === 'editing' && !this.dirtyEdits.has(id) && this.editGenerations.get(id) === generation) return;
      this.dirtyEdits.delete(id);
      this.editGenerations.set(id, generation);
      if (copy.phase !== 'saved') copy = await this.saveEdit(id) as typeof copy;
      if (copy.phase !== 'saved') return;
      const file = (await (await this.request(copy.ownerId, `/v1/files/${copy.session.resourceId}/stat`)).json()).entry;
      if (file.version !== copy.session.savedVersion) return;
      const next = (await (await this.request(copy.ownerId, '/v1/files/edits', {}, undefined, { resourceId: file.id, sourceVersion: file.version })).json()).session;
      await this.editCopies.nextRevision(id, next);
    })().catch(() => { /* Local edits and immutable save snapshots remain available for retry. */ });
    this.automaticSaves.set(id, pending); void pending.finally(() => this.automaticSaves.delete(id));
  }
  snapshot() { return { capabilities: { edits: true, editRecovery: true, editContinue: true }, devices: this.connections.map(({ id, name, address, kind, legacyPeerId }) => ({ id, name, address, kind, legacyPeerId,transport:this.usb&&this.usb.address(address)!==address?'usb':'network' })), jobs: structuredClone([...this.jobs.values()]), commandJobs: this.outbox.snapshot() }; }
  /** The gateway has already verified this request's Tailscale account and existing grant. Never trust a supplied address. */
  async acceptPhone(peerAddress: string, legacyPeerId: string, raw: unknown): Promise<void> {
    const value = raw as {owner?: {id?: string; name?: string; kind?: string}; token?: string; deviceId?: string};
    if (value?.owner?.kind !== 'phone' || !/^[a-f0-9-]{36}$/.test(legacyPeerId)) throw new Error('Invalid phone invitation.');
    await this.remember(address(`http://${peerAddress}:48240`, this.allowLoopback), value, legacyPeerId);
  }
  phoneForPeer(id: string) { return this.connections.find(item => item.kind === 'phone' && (item.id === id || item.legacyPeerId === id))?.id ?? null; }
  async pair(ownerAddress: string, code: string, name: string): Promise<void> {
    const base = address(ownerAddress, this.allowLoopback);
    const response = await fetch(`${base}/v1/devices/pair`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
    if (!response.ok) throw new Error('Pairing was refused. Generate a new code on the owner.');
    await this.remember(base, await response.json());
  }
  /** Joins an owner on the creator's own Tailscale account; no code involved. */
  async join(ownerAddress: string, name: string): Promise<void> {
    const base = address(ownerAddress, this.allowLoopback);
    const response = await fetch(`${base}/v1/devices/join`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!response.ok) throw new Error('That computer refused to connect.');
    await this.remember(base, await response.json());
  }
  /** Owners this client holds a working grant for. A revoked grant is left out so discovery joins again. */
  connectedAddresses(): string[] { return this.connections.map(connection => connection.address).filter(address => !this.revoked.has(address)); }
  /** Asks a previously paired phone to send its authenticated reverse invitation to this PC. */
  async requestPhoneAnnouncement(ownerAddress: string): Promise<void> {
    const base = address(ownerAddress, this.allowLoopback);
    const response = await fetch(`${base}/v1/devices/announce`, {redirect: 'error', signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('Phone sharing is unavailable.');
  }
  private readonly revoked = new Set<string>();
  private async remember(base: string, paired: { owner?: { id?: string; name?: string; kind?: string }; token?: string; deviceId?: string }, legacyPeerId?: string): Promise<void> {
    this.revoked.delete(base);
    if (!/^[a-f0-9-]{36}$/.test(paired.owner?.id ?? '') || typeof paired.owner?.name !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(paired.token ?? '') || !/^[a-f0-9-]{36}$/.test(paired.deviceId ?? '')) throw new Error('Invalid pairing response.');
    const owner = { id: paired.owner.id!, name: paired.owner.name }, deviceId = paired.deviceId!;
    const secret = this.secrets.seal(paired.token!);
    const next = this.saveQueue.then(async () => {
      const phone = paired.owner?.kind === 'phone';
      const previous = this.connections.find(item => item.id === owner.id);
      if (previous?.address === base && previous.secret && this.secrets.open(previous.secret) === paired.token && previous.name === owner.name && previous.legacyPeerId === legacyPeerId) return;
      const connection: Connection = { id: owner.id, name: owner.name, address: base, secret, deviceId, ...(phone ? {kind: 'phone', legacyPeerId} : {}) };
      const connections = [...this.connections.filter(item => item.id !== owner.id), connection];
      await this.store.save({ version: 1, connections });
      this.connections = connections;
      if (phone) this.watchPhone(connection);
    });
    this.saveQueue = next.catch(() => {});
    await next;
  }
  private connection(ownerId: string): Connection {
    const connection = this.connections.find(item => item.id === ownerId);
    if (!connection) throw new Error('Device is not connected.');
    return connection;
  }
  private watchPhone(connection: Connection): void {
    this.eventStreams.get(connection.id)?.abort();
    const controller = new AbortController(); this.eventStreams.set(connection.id, controller);
    void (async () => {
      let delay = 1000;
      while (!controller.signal.aborted && !this.closing) {
        try {
          const response = await this.transportFetch(`${connection.address}/v1/events`, {redirect: 'error', headers: {Authorization: `Bearer ${this.secrets.open(connection.secret)}`}, signal: controller.signal});
          if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Phone event stream is unavailable.');
          delay = 1000; this.onOwnerChanged?.(connection.id);
          const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
          try { for (;;) { const {done, value} = await reader.read(); if (done) break; buffer += decoder.decode(value, {stream: true}); if (buffer.length > 65536) throw new Error('Phone event exceeded its limit.'); let end; while ((end = buffer.indexOf('\n\n')) >= 0) { const event = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (event.includes('"proxima-changed"')) this.onOwnerChanged?.(connection.id); } } } finally { reader.releaseLock(); }
        } catch { /* Reconnect the notification stream; commands are never queued or polled here. */ }
        if (!controller.signal.aborted) await new Promise<void>(resolve => { const timer = setTimeout(done, delay); function done() { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); } controller.signal.addEventListener('abort', done, {once: true}); });
        delay = Math.min(30000, delay * 2);
      }
    })();
  }
  private async request(ownerId: string, route: string, headers: Record<string, string> = {}, signal?: AbortSignal, body?: unknown): Promise<Response> {
    const connection = this.connection(ownerId);
    const response = await this.transportFetch(`${connection.address}${route}`, { redirect: 'error', method:body===undefined?'GET':'POST', ...(body===undefined?{}:{body:JSON.stringify(body)}),headers: { Authorization: `Bearer ${this.secrets.open(connection.secret)}`,...(body===undefined?{}:{'Content-Type':'application/json'}), ...headers }, signal: signal ?? AbortSignal.timeout(30_000) });
    this.ownerResponses.set(ownerId, Date.now());
    if (response.status === 401) this.revoked.add(connection.address);
    if (!response.ok) throw new Error(response.status===503&&route.startsWith('/v1/backpacks/')?'Open Proxima on that computer, then refresh.':response.status === 412 ? 'Source changed. Refresh before downloading.' : response.status === 401 ? 'Access was revoked. Pair this device again.' : `Remote operation failed (${response.status}).`);
    return response;
  }
  async browse(ownerId: string, resourceId?: string, offset = 0) {
    if (resourceId && !/^[a-f0-9-]{36}$/.test(resourceId)) throw new Error('Invalid file identity.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid listing page.');
    const route = resourceId ? `/v1/files/${resourceId}/list?offset=${offset}` : '/v1/files/shares';
    const key = createHash('sha256').update(JSON.stringify([ownerId, resourceId ?? '', offset])).digest('hex');
    const listing = new AtomicJsonStore(path.join(this.directory, 'listings', `${key}.json`), { recoveryDir: path.join(this.directory, 'recovery') });
    try {
      const response = await (await this.request(ownerId, route)).json();
      if (response.owner && response.owner.id !== ownerId) throw new Error('Owner identity changed; pair again.');
      if (!Array.isArray(response.entries)) throw new Error('Invalid listing.');
      const result = { entries: response.entries.map(entry), nextOffset: response.nextOffset ?? null,capabilities:response.capabilities??{},folder:response.folder?entry(response.folder):null };
      await listing.save(result);
      return { ...result, online: true };
    } catch (error) {
      const cached = await listing.load<{ entries: RemoteFileEntry[]; nextOffset: number | null }>();
      if (!cached.value) throw error;
      return { ...cached.value, online: Date.now() - (this.ownerResponses.get(ownerId) ?? 0) < 15000, stale: true, error: error instanceof Error ? error.message : 'Owner unavailable.' };
    }
  }
  download(ownerId: string, raw: unknown, scope?:string): RemoteDownloadJob {
    if(scope&&!/^[a-f0-9-]{36}$/.test(scope))throw Error('Invalid download scope.');
    const file = entry(raw);
    if (file.kind !== 'file') throw new Error('Choose a file to download.');
    this.connection(ownerId);
    const existing = [...this.jobs.values()].find(job => job.ownerId === ownerId && job.entry.id === file.id && job.entry.version === file.version && job.scope===scope && job.phase !== 'failed');
    if (existing) return structuredClone(existing);
    const job: RemoteDownloadJob = { id: randomUUID(), ownerId, entry: file, phase: 'queued', bytes: 0,...(scope?{scope}:{}) };
    this.jobs.set(job.id, job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const transfer = this.transfer(job, controller.signal).catch(error => { job.phase = 'failed'; job.error = error instanceof Error ? error.message : 'Transfer failed.'; }).finally(() => { this.controllers.delete(job.id); this.transfers.delete(job.id); });
    this.transfers.set(job.id, transfer);
    return structuredClone(job);
  }
  private async dispatchChange(ownerId:string,command:unknown){return (await (await this.request(ownerId,'/v1/files/changes',{},undefined,command)).json()).job;}
  beginEdit(ownerId: string, raw: unknown) {
    const pending = this.openEdit(ownerId, raw);
    this.editOpenings.add(pending);
    void pending.finally(() => this.editOpenings.delete(pending)).catch(() => {});
    return pending;
  }
  private async openEdit(ownerId: string, raw: unknown) {
    if (this.closing) throw new Error('Remote file client is closing.');
    const file = entry(raw);
    if (file.kind !== 'file') throw new Error('Choose a file to edit.');
    const response = await (await this.request(ownerId, '/v1/files/edits', {}, undefined, { resourceId: file.id, sourceVersion: file.version })).json();
    const session = response.session;
    if (this.closing) throw new Error('Remote file client is closing.');
    if (session?.resourceId !== file.id || session?.sourceVersion !== file.version || session?.phase !== 'editing') throw new Error('Invalid remote edit session.');
    const job = this.download(ownerId, file);
    await this.transfers.get(job.id);
    const completed = this.jobs.get(job.id);
    if (completed?.phase !== 'completed') throw new Error(completed?.error ?? 'The source download is not complete.');
    if (this.closing) throw new Error('Remote file client is closing.');
    const key = createHash('sha256').update(JSON.stringify([ownerId, file.id, file.version])).digest('hex');
    return this.editCopies.create(ownerId, session, file.name, await this.cachedPath(ownerId, key));
  }
  localEdits(ownerId?: string) { return this.editCopies.list(ownerId); }
  editRecovery(ownerId?: string) { return this.editCopies.inventory(ownerId).then(value => value.recovery); }
  editRecoveryPath(id: string) { return this.editCopies.recoveryPath(id); }
  editPath(id: string) { return this.editCopies.workingPath(id); }
  continueEdit(id: string) {
    const pending = this.continueWorkingCopy(id);
    this.editOpenings.add(pending);
    void pending.finally(() => this.editOpenings.delete(pending)).catch(() => {});
    return pending;
  }
  private async continueWorkingCopy(id: string) {
    if (this.closing) throw new Error('Remote file client is closing.');
    const previous = await this.editCopies.read(id);
    if (previous.phase !== 'saved' || !previous.session.savedVersion) throw new Error('Resolve the previous save before continuing.');
    const source = (await (await this.request(previous.ownerId, `/v1/files/${previous.session.resourceId}/stat`)).json()).entry;
    if (source?.version !== previous.session.savedVersion) throw new Error('The owner changed this file after your save. Keep your local edits and compare the owner’s current file before starting another session.');
    const next = await this.beginEdit(previous.ownerId, source);
    if (this.closing) throw new Error('Remote file client is closing.');
    await this.editCopies.carryWorkingCopy(previous.id, next.id);
    return next;
  }
  saveEdit(id: string) {
    const existing = this.editSaves.get(id); if (existing) return existing;
    const pending = this.saveWorkingCopy(id);
    this.editSaves.set(id, pending);
    void pending.finally(() => this.editSaves.delete(id)).catch(() => {});
    return pending;
  }
  private async saveWorkingCopy(id: string) {
    if (this.closing) throw new Error('Remote file client is closing.');
    const record = await this.editCopies.prepare(id);
    if (record.phase === 'saved' || record.phase === 'conflict') return record;
    const ownerId = record.ownerId;
    const snapshot = await this.editCopies.saveSnapshot(id);
    const json = async (route: string, body?: unknown) => (await this.request(ownerId, route, {}, undefined, body)).json();
    try {
      if (!record.uploadId) {
        const begun = await json(`/v1/files/edits/${record.session.id}/uploads`, { bytes: record.editedBytes, sha256: record.editedSha256 });
        if (!/^[a-f0-9-]{36}$/.test(begun.uploadId ?? '')) throw new Error('Invalid upload receipt.');
        record.uploadId = begun.uploadId; await this.editCopies.retain(record);
      }
      const uploadRoute = `/v1/files/edits/uploads/${record.uploadId}`;
      const status = (await json(uploadRoute)).upload;
      if (status?.sessionId !== record.session.id || status?.bytes !== record.editedBytes || status?.sha256 !== record.editedSha256 || !Number.isSafeInteger(status.receivedBytes) || status.receivedBytes < 0 || status.receivedBytes > record.editedBytes!) throw new Error('Upload resume receipt does not match this save.');
      const file = await fs.open(snapshot, 'r');
      try {
        const prefix = createHash('sha256');
        if (status.receivedBytes) for await (const chunk of file.createReadStream({ start: 0, end: status.receivedBytes - 1, autoClose: false })) prefix.update(chunk);
        if (prefix.digest('hex') !== status.prefixSha256) throw new Error('Retained owner prefix differs; keep both copies for recovery.');
        let offset = status.receivedBytes;
        const connection = this.connection(ownerId);
        while (offset < record.editedBytes!) {
          if (this.closing) throw new Error('Remote file client is closing.');
          const buffer = Buffer.alloc(Math.min(4 * 1024 ** 2, record.editedBytes! - offset));
          const read = await file.read(buffer, 0, buffer.length, offset);
          if (read.bytesRead !== buffer.length) throw new Error('Retained save snapshot changed.');
          const response = await this.transportFetch(`${connection.address}${uploadRoute}?offset=${offset}`, { method: 'PUT', redirect: 'error', headers: { Authorization: `Bearer ${this.secrets.open(connection.secret)}` }, body: buffer, signal: AbortSignal.timeout(60_000) });
          if (response.status === 401) this.revoked.add(connection.address);
          if (!response.ok || (await response.json()).receivedBytes !== offset + buffer.length) throw new Error('Upload was not confirmed. The retained snapshot can be resumed.');
          offset += buffer.length;
        }
      } finally { await file.close(); }
      if (this.closing) throw new Error('Remote file client is closing.');
      await json(uploadRoute + '/seal', {});
      const result = (await json(`/v1/files/edits/${record.session.id}/save`, { saveId: record.saveId, uploadId: record.uploadId, sha256: record.editedSha256 })).session;
      if (result?.id !== record.session.id || result.saveId !== record.saveId || result.editedSha256 !== record.editedSha256 || !['saved','conflict','uncertain'].includes(result.phase)) throw new Error('Invalid save receipt. Keep the retained snapshot.');
      record.phase = result.phase; record.session = result;
      await this.editCopies.retain(record); return record;
    } catch (error) {
      record.phase = 'uncertain'; await this.editCopies.retain(record); throw error;
    }
  }
  async change(ownerId:string,command:unknown){return this.outbox.send(ownerId,this.connection(ownerId).deviceId,command,value=>this.dispatchChange(ownerId,value));}
  async retryChange(ownerId:string,commandId:string){return this.outbox.retry(ownerId,this.connection(ownerId).deviceId,commandId,value=>this.dispatchChange(ownerId,value));}
  async changes(ownerId:string){const jobs=(await (await this.request(ownerId,'/v1/files/changes')).json()).jobs;if(!Array.isArray(jobs))throw new Error('Invalid file request history.');await this.outbox.reconcile(ownerId,jobs);return jobs;}
  async backpacks(ownerId:string){
    const key=createHash('sha256').update(ownerId).digest('hex'),cache=new AtomicJsonStore(path.join(this.directory,'backpacks',key+'-catalog.json'),{recoveryDir:path.join(this.directory,'recovery')});
    try{const response=await (await this.request(ownerId,'/v1/backpacks')).json();if(response.owner?.id!==ownerId||!Array.isArray(response.entries)||response.entries.some((item:{id?:string;name?:string;kind?:string})=>!/^[a-f0-9-]{36}$/.test(item.id??'')||typeof item.name!=='string'||item.kind!=='proxima'))throw Error('Invalid shared Backpack listing.');await cache.save(response);return {...response,online:true};}catch(error){const saved=await cache.load<Record<string,unknown>>();if(!saved.value)throw error;return {...saved.value,online:false,error:error instanceof Error?error.message:'Owner unavailable.'};}
  }
  async backpackSnapshot(ownerId:string,resourceId:string){
    if(!/^[a-f0-9-]{36}$/.test(resourceId))throw Error('Invalid shared Backpack identity.');const key=createHash('sha256').update(JSON.stringify([ownerId,resourceId])).digest('hex'),cache=new AtomicJsonStore(path.join(this.directory,'backpacks',key+'.json'),{recoveryDir:path.join(this.directory,'recovery')});
    try{const response=await(await this.request(ownerId,'/v1/backpacks/'+resourceId+'/snapshot')).json();if(response.owner?.id!==ownerId||response.resourceId!==resourceId||response.kind!=='proxima')throw Error('Shared Backpack identity changed.');await cache.save(response);return {...response,online:true};}catch(error){const saved=await cache.load<Record<string,unknown>>();if(!saved.value)throw error;return {...saved.value,online:false,error:error instanceof Error?error.message:'Owner unavailable.'};}
  }
  async backpackCommand(ownerId:string,resourceId:string,command:unknown){
    if(!/^[a-f0-9-]{36}$/.test(resourceId))throw Error('Invalid shared Backpack identity.');
    const response=await(await this.request(ownerId,'/v1/backpacks/'+resourceId+'/commands',{},undefined,command)).json();
    if(response.owner?.id!==ownerId||response.resourceId!==resourceId||response.kind!=='proxima'||!response.command||typeof response.command.ok!=='boolean'||!response.snapshot)throw Error('Owner command confirmation is invalid.');
    return {...response,online:true};
  }
  async backpackReplace(ownerId:string,resourceId:string,projection:unknown){
    if(!/^[a-f0-9-]{36}$/.test(resourceId))throw Error('Invalid shared Backpack identity.');
    const response=await(await this.request(ownerId,'/v1/backpacks/'+resourceId+'/replace',{},undefined,projection)).json();
    if(response.owner?.id!==ownerId||response.resourceId!==resourceId||response.kind!=='proxima')throw Error('Owner replacement confirmation is invalid.');
    return response;
  }
  async backpackView(ownerId:string,resourceId:string){
    if(!/^[a-f0-9-]{36}$/.test(resourceId))throw Error('Invalid shared Backpack identity.');
    const response=await(await this.request(ownerId,'/v1/backpacks/'+resourceId+'/snapshot?control=1')).json();
    if(response.owner?.id!==ownerId||response.resourceId!==resourceId||response.kind!=='proxima'||!response.snapshot)throw Error('Source Proxima identity changed.');
    return {...response,online:true};
  }
  private async transfer(job: RemoteDownloadJob, signal: AbortSignal): Promise<void> {
    const headers = { 'If-Match': `"${job.entry.version}"` };
    const digest = await (await this.request(job.ownerId, `/v1/files/${job.entry.id}/digest`, headers, signal)).json();
    if (digest.version !== job.entry.version || digest.size !== job.entry.size || !/^[a-f0-9]{64}$/.test(digest.sha256)) throw new Error('Invalid source verification.');
    const key = createHash('sha256').update(JSON.stringify([job.ownerId, job.entry.id, job.entry.version])).digest('hex');
    const directory = path.join(this.directory, 'content');
    await fs.mkdir(directory, { recursive: true });
    const partial = path.join(directory, `${key}${job.scope?'.'+job.scope:''}.partial`);
    const complete = path.join(directory, `${key}${extension(job.entry.name)}`);
    const metadata = new AtomicJsonStore(path.join(directory, `${key}.json`), { recoveryDir: path.join(this.directory, 'recovery') });
    let offset = await fs.stat(partial).then(stats => stats.size).catch(error => { if (error.code !== 'ENOENT') throw error; return 0; });
    if (offset > job.entry.size) { await fs.rename(partial, `${partial}.${randomUUID()}.invalid`); offset = 0; }
    job.phase = 'transferring'; job.bytes = offset;
    if (offset < job.entry.size) {
      const response = await this.request(job.ownerId, `/v1/files/${job.entry.id}/content`, { ...headers, ...(offset ? { Range: `bytes=${offset}-` } : {}) }, signal);
      if ((offset && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${job.entry.size - 1}/${job.entry.size}`)) || response.headers.get('etag') !== headers['If-Match']) throw new Error('Source cannot resume this version safely.');
      const progress = new Transform({ transform(chunk, _encoding, callback) { job.bytes += chunk.length; callback(null, chunk); } });
      if (!response.body) throw new Error('Remote file content is missing.');
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), progress, createWriteStream(partial, { flags: offset ? 'a' : 'w' }), { signal });
    } else if (!offset) await fs.writeFile(partial, '');
    job.phase = 'verifying';
    const hash = createHash('sha256');
    await pipeline(createReadStream(partial), hash, { signal });
    if ((await fs.stat(partial)).size !== job.entry.size || hash.digest('hex') !== digest.sha256) {
      await fs.rename(partial, `${partial}.${randomUUID()}.invalid`);
      throw new Error('Download verification failed. Retry to retrieve a clean copy.');
    }
    await fs.rename(partial, complete);
    await metadata.save({ ownerId: job.ownerId, entry: job.entry, sha256: digest.sha256, key } satisfies CachedFile);
    job.bytes = job.entry.size; job.phase = 'completed';
    void this.pruneContentCache().catch(() => {});
  }
  async offline(ownerId: string): Promise<CachedFile[]> {
    const directory = path.join(this.directory, 'content');
    const names = await fs.readdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return [] as string[]; });
    const files: CachedFile[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const value = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as CachedFile;
      if (value.ownerId === ownerId && /^[a-f0-9]{64}$/.test(value.key) && (await fs.stat(path.join(directory, `${value.key}${extension(value.entry.name)}`)).catch(() => null))?.size === value.entry.size) files.push(value);
    }
    return files;
  }
  /** Sends one local file into a folder on the owner; the owner verifies size and SHA-256 and never overwrites. */
  async upload(ownerId: string, folderId: string, localFile: string, name: string): Promise<RemoteFileEntry> {
    if (!/^[a-f0-9-]{36}$/.test(folderId)) throw new Error('Invalid folder identity.');
    const stats = await fs.stat(localFile);
    if (!stats.isFile()) throw new Error('Only files can be uploaded.');
    const hash = createHash('sha256');
    await pipeline(createReadStream(localFile), hash);
    const query = new URLSearchParams({ name, size: String(stats.size), sha256: hash.digest('hex') });
    const connection = this.connection(ownerId);
    const saved=await this.request(ownerId,`/v1/files/${folderId}/upload?${query}`).then(r=>r.json()).catch(error=>{if(connection.kind==='phone')throw error;return null;});
    if(saved?.entry){const current=await fs.stat(localFile);if(current.size!==stats.size||current.mtimeMs!==stats.mtimeMs||current.ino!==stats.ino)throw Error('Local source changed before reuse.');return entry(saved.entry);}
    const tus = await this.transportFetch(connection.address + '/v1/files/transfers', { method: 'OPTIONS', redirect: 'error', headers: { Authorization: `Bearer ${this.secrets.open(connection.secret)}` }, signal: AbortSignal.timeout(5000) }).then(response => response.ok && response.headers.get('tus-version')?.split(',').includes('1.0.0')).catch(() => false);
    if (tus) {
      const sha256 = query.get('sha256')!;
      const key = createHash('sha256').update(JSON.stringify([ownerId, folderId, name, stats.dev, stats.ino, stats.ctimeMs, stats.size, sha256])).digest('hex');
      const url = await uploadWithTus({ address: connection.address, token: this.secrets.open(connection.secret), file: localFile, folderId, name, size: stats.size, sha256, journal: path.join(this.directory, 'uploads', key + '.json'), httpStack:this.usb?.httpStack() });
      const response = await this.request(ownerId, new URL(url).pathname + '/commit', {}, undefined, {});
      return entry((await response.json()).entry);
    }
    let offset = 0;
    if (connection.kind === 'phone'&&saved) {
      if (!Number.isSafeInteger(saved.receivedBytes) || saved.receivedBytes < 0 || saved.receivedBytes > stats.size || !/^[a-f0-9]{64}$/.test(saved.prefixSha256)) throw new Error('Invalid phone resume receipt.');
      const prefix = createHash('sha256');
      if (saved.receivedBytes) await pipeline(createReadStream(localFile, {start: 0, end: saved.receivedBytes - 1}), prefix);
      if (prefix.digest('hex') === saved.prefixSha256) offset = saved.receivedBytes;
    }
    const current = await fs.stat(localFile);
    if (current.size !== stats.size || current.mtimeMs !== stats.mtimeMs) throw new Error('Local source changed before upload.');
    const response = await this.transportFetch(`${connection.address}/v1/files/${folderId}/upload?${query}`, {
      method: 'PUT', redirect: 'error', duplex: 'half',
      headers: { Authorization: `Bearer ${this.secrets.open(connection.secret)}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(stats.size - offset), ...(connection.kind === 'phone' ? {'X-Papers-Offset': String(offset)} : {}) },
      body: offset === stats.size ? new Uint8Array() : Readable.toWeb(createReadStream(localFile, {start: offset})) as unknown as BodyInit,
    } as RequestInit & { duplex: 'half' });
    if (response.status === 401) this.revoked.add(connection.address);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? `Upload failed (${response.status}).`);
    return entry(result.entry);
  }
  /** As you Go workspaces this owner lets the device open and edit. */
  async workspaces(ownerId: string): Promise<{ id: string; name: string; kind: 'as-you-go' }[]> {
    const response = await (await this.request(ownerId, '/v1/workspaces')).json();
    if (response.owner?.id !== ownerId || !Array.isArray(response.entries)) throw new Error('Invalid workspace listing.');
    return response.entries.filter((item: { id?: string; name?: unknown }) => /^[a-f0-9-]{36}$/.test(item.id ?? '') && typeof item.name === 'string');
  }
  /** The owner's current document and the revision it is at. */
  async workspaceLoad(ownerId: string, id: string): Promise<{ state: unknown; revision: string; sharedRoots?: string[] }> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid workspace identity.');
    const response = await (await this.request(ownerId, `/v1/workspaces/${id}/state`)).json();
    if (typeof response.revision !== 'string') throw new Error('Invalid workspace document.');
    return { state: response.state, revision: response.revision, ...(Array.isArray(response.sharedRoots) && response.sharedRoots.every((name: unknown) => typeof name === 'string' && !/[\\/]/.test(name)) ? {sharedRoots: response.sharedRoots} : {}) };
  }
  /** One of the owner's As you Go icon files, as a data URL for display. */
  async workspaceIcon(ownerId: string, id: string, name: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}\.[a-z]{2,4}$/.test(name)) throw new Error('Invalid icon.');
    const response = await this.request(ownerId, `/v1/workspaces/${id}/icons/${name}`);
    const type = response.headers.get('content-type') ?? '';
    if (!/^image\/[a-z+.-]+$/.test(type)) throw new Error('Invalid icon.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Icon is too large.');
    return `data:${type};base64,${bytes.toString('base64')}`;
  }
  /** Offers a document built on `revision`; the owner refuses it if its copy moved on. */
  async workspaceSave(ownerId: string, id: string, state: string, revision: string): Promise<{ ok: boolean; revision: string; code?: string }> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid workspace identity.');
    const response = await (await this.request(ownerId, `/v1/workspaces/${id}/state`, {}, AbortSignal.timeout(120_000), { state, revision })).json();
    if (typeof response.save?.ok !== 'boolean' || typeof response.save.revision !== 'string') throw new Error('Invalid save receipt.');
    return response.save;
  }
  /** Runs a search on the owner (its own Everything); results come back as share-relative parts. */
  async targets(ownerId:string,request:Record<string,unknown>):Promise<Record<string,unknown>>{
    const response=await(await this.request(ownerId,'/v1/files/targets',{},undefined,request)).json();
    const target=response.target;if(!target||typeof target.targetId!=='string'||typeof target.status!=='string')throw Error('Invalid file target response');
    if(target.parts&&(!Array.isArray(target.parts)||!target.parts.every((p:unknown)=>typeof p==='string'&&p&&!/[\\/]/.test(p)&&p!=='.'&&p!=='..')))throw Error('Invalid target location');
    return target;
  }
  async search(ownerId: string, query: string, limit: number): Promise<{ parts: string[]; name: string; kind: 'file' | 'folder'; size: number | null; modifiedAt: number | null }[]> {
    const response = await (await this.request(ownerId, `/v1/files/search?${new URLSearchParams({ q: query, limit: String(limit) })}`)).json();
    if (!Array.isArray(response.results)) throw new Error('Invalid search results.');
    return response.results.filter((item: { parts?: unknown; name?: unknown }) => Array.isArray(item.parts) && item.parts.every(part => typeof part === 'string' && part && !/[\\/]/.test(part) && part !== '..') && typeof item.name === 'string');
  }
  /** The owner's default inbox folder for dropped files. */
  async inbox(ownerId: string): Promise<{ entry: RemoteFileEntry; parts: string[]; chosen?:boolean }> {
    const response = await (await this.request(ownerId, '/v1/files/inbox')).json();
    if (!Array.isArray(response.parts) || !response.parts.every((part: unknown) => typeof part === 'string' && part && !/[\\/]/.test(part as string))) throw new Error('Invalid inbox.');
    return { entry: entry(response.entry??response.folder), parts: response.parts,chosen:response.chosen===true };
  }
  async setInbox(ownerId:string,parts:string[]|null){await this.request(ownerId,'/v1/files/inbox',{},undefined,{parts});return this.inbox(ownerId);}
  /** Downloads (or reuses) a verified local copy of one exact remote version and returns its path. */
  async materialize(ownerId: string, raw: unknown, controls?:{scope:string;onJob:(job:RemoteDownloadJob)=>void}): Promise<string> {
    const file = entry(raw);
    const key = createHash('sha256').update(JSON.stringify([ownerId, file.id, file.version])).digest('hex');
    const cached = await this.cachedPath(ownerId, key).catch(() => null);
    if (cached) return cached;
    const job = this.download(ownerId, file,controls?.scope);controls?.onJob(job);
    await this.transfers.get(job.id);
    const completed = this.jobs.get(job.id);
    if (completed?.phase !== 'completed') throw new Error(completed?.error ?? 'The download did not complete.');
    return this.cachedPath(ownerId, key);
  }
  cancel(id: string): void { this.controllers.get(id)?.abort(); }
  async contentDigest(ownerId:string,raw:unknown):Promise<string>{const file=entry(raw);const result=await(await this.request(ownerId,`/v1/files/${file.id}/digest`,{'If-Match':`"${file.version}"`})).json();if(result.version!==file.version||result.size!==file.size||!/^[a-f0-9]{64}$/.test(result.sha256))throw Error('Source verification changed.');return result.sha256;}
  /** The owner's own rendering of a file when it is an image or text (a Revit or DWG thumbnail, a
   * picture, text): Preview shows it without downloading the file. Null when it needs the file itself. */
  async ownerPreview(ownerId: string, raw: unknown): Promise<Record<string, unknown> | null> {
    const file = entry(raw);
    const response = await (await this.request(ownerId, `/v1/files/${file.id}/preview`, {}, AbortSignal.timeout(60_000))).json();
    const preview = response?.ok === true ? response.preview : null;
    return preview && (preview.kind === 'image' ? typeof preview.dataUrl === 'string' : preview.kind === 'text' && typeof preview.text === 'string') ? preview : null;
  }
  async ownerThumbnail(ownerId:string,raw:unknown):Promise<Record<string,unknown>|null>{
    const file=entry(raw);
    const response=await(await this.request(ownerId,`/v1/files/${file.id}/thumbnail`,{},AbortSignal.timeout(15_000))).json();
    const preview=response?.ok===true?response.preview:null;
    return preview?.kind==='image'&&typeof preview.dataUrl==='string'&&preview.dataUrl.startsWith('data:image/')&&preview.dataUrl.length<=180_000?preview:null;
  }
  /** Custom pictures of a folder's children, kept on the owner (customIconStore). A drive list has none. */
  async customIcons(ownerId: string, folderId: string | null): Promise<Record<string, string>> {
    if (!folderId || !/^[a-f0-9-]{36}$/.test(folderId)) return {};
    const response = await (await this.request(ownerId, `/v1/files/${folderId}/custom-icons`)).json();
    const out: Record<string, string> = {};
    for (const [name, icon] of Object.entries(response?.ok === true && response.icons && typeof response.icons === 'object' ? response.icons : {})) if (typeof icon === 'string' && icon.startsWith('data:image/') && icon.length <= 256 * 1024) out[name] = icon;
    return out;
  }
  async setCustomIcon(ownerId: string, entryId: string, icon: string | null): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(entryId)) throw new Error('Invalid file identity.');
    await this.request(ownerId, `/v1/files/${entryId}/custom-icon`, {}, undefined, { icon }).catch(error => { throw new Error(/\(403\)/.test(String(error?.message)) ? 'That device does not allow changes from this one.' : /\((404|405|400)\)/.test(String(error?.message)) ? 'That device needs a Papers update to keep custom pictures.' : error.message); });
  }
  /** Whether this exact version is already in the copy cache (Preview asks before large downloads). */
  async isCached(ownerId: string, raw: unknown): Promise<boolean> {
    const file = entry(raw);
    const key = createHash('sha256').update(JSON.stringify([ownerId, file.id, file.version])).digest('hex');
    const stats = await fs.stat(path.join(this.directory, 'content', `${key}${extension(file.name)}`)).catch(() => null);
    return stats?.size === file.size;
  }
  async cachedPath(ownerId: string, key: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cached file identity.');
    const cached = (await this.offline(ownerId)).find(file => file.key === key);
    if (!cached) throw new Error('Offline file is unavailable.');
    const target = path.join(this.directory, 'content', `${key}${extension(cached.entry.name)}`);
    const hash = createHash('sha256');
    await pipeline(createReadStream(target), hash);
    if (hash.digest('hex') !== cached.sha256) throw new Error('Offline copy is damaged. Download a fresh copy.');
    const now = new Date();
    await fs.utimes(target, now, now).catch(() => {}); // last used, for the cache limit
    return target;
  }
  /**
   * Keeps the copy cache bounded: copies unused for 14 days are removed, then the least recently used
   * until it fits in 2 GB. Copies still downloading are kept, and a copy Windows reports as open
   * (a video playing in Preview) is skipped. Every copy is a duplicate of a file on its device.
   */
  async pruneContentCache(now = Date.now(), maxAge = CONTENT_CACHE_MAX_AGE_MS, maxBytes = CONTENT_CACHE_MAX_BYTES): Promise<{ removed: number; bytes: number }> {
    const directory = path.join(this.directory, 'content');
    const names = await fs.readdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return [] as string[]; });
    const active = new Set([...this.jobs.values()].filter(job => !['completed', 'failed'].includes(job.phase))
      .map(job => createHash('sha256').update(JSON.stringify([job.ownerId, job.entry.id, job.entry.version])).digest('hex')));
    const copies: { key: string; file: string; size: number; used: number }[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const key = name.slice(0, 64);
      if (active.has(key)) continue;
      const value = await fs.readFile(path.join(directory, name), 'utf8').then(text => JSON.parse(text) as CachedFile).catch(() => null);
      if (!value?.entry?.name) continue;
      const file = path.join(directory, `${key}${extension(value.entry.name)}`);
      const stats = await fs.stat(file).catch(() => null);
      if (stats) copies.push({ key, file, size: stats.size, used: stats.mtimeMs });
    }
    copies.sort((a, b) => a.used - b.used);
    let total = copies.reduce((sum, copy) => sum + copy.size, 0), removed = 0;
    for (const copy of copies) {
      if (now - copy.used <= maxAge && total <= maxBytes) break;
      try { await fs.unlink(copy.file); } catch { continue; } // open elsewhere: keep it this time
      await fs.unlink(path.join(directory, `${copy.key}.json`)).catch(() => {});
      total -= copy.size; removed++;
    }
    // Abandoned partial and rejected downloads older than the age limit.
    for (const name of names.filter(name => /\.(partial|invalid)$/.test(name))) {
      const stats = await fs.stat(path.join(directory, name)).catch(() => null);
      if (stats && now - stats.mtimeMs > maxAge && ![...active].some(key => name.startsWith(key))) await fs.unlink(path.join(directory, name)).catch(() => {});
    }
    return { removed, bytes: total };
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.usb?.close();
    clearInterval(this.assignmentTimer);
    await Promise.allSettled([...this.editWatchers.values()].map(watcher => watcher.close()));
    await Promise.allSettled([...this.automaticSaves.values()]);
    for (const controller of this.eventStreams.values()) controller.abort();
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.transfers.values()]);
    await Promise.allSettled([...this.editOpenings]);
    await Promise.allSettled([...this.editSaves.values()]);
    await this.saveQueue;
    await this.outbox.close();
  }
}
