/**
 * Program state persistence — isolated per Backpack and program identity
 * (plan section 10). Programs own their state shape; Papers stores it
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
}
