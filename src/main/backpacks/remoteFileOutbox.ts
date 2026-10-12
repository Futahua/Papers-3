import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AtomicJsonStore } from '../persistence/atomicStore';

interface PendingCommand {
  ownerId: string;
  deviceId: string;
  command: Record<string, unknown> & { commandId: string };
  phase: 'submitting' | 'uncertain' | 'accepted' | 'completed' | 'failed';
  error?: string;
}

/** Persist before dispatch; retry the same command identity after an ambiguous response. */
export class RemoteFileOutbox {
  private commands: PendingCommand[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly flights = new Map<string, Promise<unknown>>();
  private readonly store: AtomicJsonStore;
  constructor(private readonly directory: string) {
    this.store = new AtomicJsonStore(path.join(directory, 'outbox.json'), { recoveryDir: path.join(directory, 'recovery') });
  }
  async initialize() {
    let raw: { commands: PendingCommand[] };
    try { raw = JSON.parse(await fs.readFile(path.join(this.directory, 'outbox.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await fs.access(this.store.backupPath); throw new Error('File request history needs explicit recovery.'); }
      catch (backupError) { if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') throw backupError; }
      return;
    }
    if (!Array.isArray(raw.commands)) throw new Error('Invalid file request history.');
    for (const record of raw.commands) {
      if (!/^[a-f0-9-]{36}$/.test(record.ownerId) || !/^[a-f0-9-]{36}$/.test(record.deviceId) || !/^[a-f0-9-]{36}$/.test(record.command?.commandId) || !['submitting','uncertain','accepted','completed','failed'].includes(record.phase)) throw new Error('Invalid file request history.');
      if (record.phase === 'submitting') { record.phase = 'uncertain'; record.error = 'Connection ended before the owner acknowledged this request. Retry checks the same request.'; }
    }
    this.commands = raw.commands;
    await this.persist();
  }
  snapshot() {
    return this.commands.map(record => ({ ownerId: record.ownerId, commandId: record.command.commandId, operation: record.command.operation, phase: record.phase, ...(record.error ? { error: record.error } : {}) }));
  }
  private persist() {
    const snapshot = structuredClone({ commands: this.commands });
    const saved = this.queue.then(() => this.store.save(snapshot)); this.queue = saved.catch(() => {}); return saved;
  }
  async send(ownerId: string, deviceId: string, raw: unknown, dispatch: (command: unknown) => Promise<unknown>): Promise<unknown> {
    if (!raw || typeof raw !== 'object' || !/^[a-f0-9-]{36}$/.test((raw as Record<string, string>).commandId ?? '')) throw new Error('Invalid file request identity.');
    const command = structuredClone(raw) as PendingCommand['command'];
    const key = JSON.stringify([ownerId, command.commandId]);
    const existing = this.commands.find(record => record.ownerId === ownerId && record.command.commandId === command.commandId);
    if (existing && (existing.deviceId !== deviceId || JSON.stringify(existing.command) !== JSON.stringify(command))) throw new Error('This request belongs to a different pairing or operation.');
    if (!existing && this.commands.some(record => record.ownerId === ownerId && record.deviceId === deviceId && record.command.resourceId === command.resourceId && ['submitting','uncertain'].includes(record.phase))) throw new Error('Retry the saved request before starting another change to this item.');
    const flight = this.flights.get(key); if (flight) return flight;
    const record = existing ?? { ownerId, deviceId, command, phase: 'submitting' as const };
    if (!existing) this.commands.push(record);
    const run = (async () => {
      record.phase = 'submitting'; delete record.error;
      try { await this.persist(); } // No network request is sent if the local journal cannot be saved.
      catch (error) { record.phase = 'uncertain'; record.error = 'This device could not save the request. It has not been sent.'; throw error; }
      try {
        const job = await dispatch(command) as { commandId?: string; phase?: string };
        if (job?.commandId !== command.commandId || !['queued','checking','waiting','verifying','completed','failed','uncertain'].includes(job.phase ?? '')) throw new Error('Invalid file request acknowledgement.');
        record.phase = job.phase === 'completed' ? 'completed' : job.phase === 'failed' ? 'failed' : 'accepted';
        await this.persist(); return job;
      } catch (error) {
        record.phase = 'uncertain'; record.error = 'The response was not confirmed. Retry this saved request to check its outcome.';
        await this.persist(); throw error;
      }
    })();
    this.flights.set(key, run);
    try { return await run; } finally { this.flights.delete(key); }
  }
  async retry(ownerId: string, deviceId: string, commandId: string, dispatch: (command: unknown) => Promise<unknown>) {
    const record = this.commands.find(item => item.ownerId === ownerId && item.command.commandId === commandId);
    if (!record) throw new Error('Saved file request is unavailable.');
    return this.send(ownerId, deviceId, record.command, dispatch);
  }
  async reconcile(ownerId: string, jobs: Array<{ commandId: string; phase: string }>) {
    let changed = false;
    for (const job of jobs) {
      const record = this.commands.find(item => item.ownerId === ownerId && item.command.commandId === job.commandId);
      if (!record || this.flights.has(JSON.stringify([ownerId, job.commandId]))) continue;
      const phase = job.phase === 'completed' ? 'completed' : job.phase === 'failed' ? 'failed' : 'accepted';
      if (record.phase !== phase || record.error) { record.phase = phase; delete record.error; changed = true; }
    }
    if (changed) await this.persist();
  }
  async close() { await Promise.allSettled([...this.flights.values()]); await this.queue; }
}
