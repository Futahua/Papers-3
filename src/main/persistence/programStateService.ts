/**
 * Program state persistence — isolated per Backpack and program identity.
 * Programs own their state shape; Papers stores it
 * opaquely with atomic writes and backup/quarantine behavior.
 */
import { AtomicJsonStore } from './atomicStore';
import { programStateFile, type PapersPaths } from './paths';

const MAX_STATE_BYTES = 8_000_000;

export class ProgramStateService {
  private readonly stores = new Map<string, AtomicJsonStore>();

  constructor(private readonly paths: PapersPaths) {}

  private storeFor(backpackId: string, programId: string): AtomicJsonStore {
    const key = `${backpackId}/${programId}`;
    let store = this.stores.get(key);
    if (!store) {
      store = new AtomicJsonStore(programStateFile(this.paths, backpackId, programId), {
        recoveryDir: this.paths.recoveryDir,
      });
      this.stores.set(key, store);
    }
    return store;
  }

  async load(backpackId: string, programId: string): Promise<unknown> {
    const report = await this.storeFor(backpackId, programId).load<unknown>();
    return report.value;
  }

  async save(backpackId: string, programId: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('state is not serializable');
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
      throw new Error(`state exceeds ${MAX_STATE_BYTES} bytes`);
    }
    await this.storeFor(backpackId, programId).save(value);
  }

  // ------------------------------------------------------- shared summaries
  // A program explicitly publishes a summary object; Papers stores it opaquely
  // and serves it only to programs granted program.read-shared-summary.

  private summaryStoreFor(backpackId: string, programId: string): AtomicJsonStore {
    const key = `summary:${backpackId}/${programId}`;
    let store = this.stores.get(key);
    if (!store) {
      const file = programStateFile(this.paths, backpackId, programId).replace(
        /state\.json$/,
        'shared-summary.json',
      );
      store = new AtomicJsonStore(file, { recoveryDir: this.paths.recoveryDir });
      this.stores.set(key, store);
    }
    return store;
  }

  async publishSummary(backpackId: string, programId: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('summary is not serializable');
    if (Buffer.byteLength(serialized, 'utf8') > 200_000) {
      throw new Error('summary exceeds 200000 bytes');
    }
    await this.summaryStoreFor(backpackId, programId).save(value);
  }

  async readSummary(backpackId: string, programId: string): Promise<unknown> {
    const report = await this.summaryStoreFor(backpackId, programId).load<unknown>();
    return report.value;
  }
}
