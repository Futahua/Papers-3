/**
 * PermissionStore — persisted "Allow for this program" grants plus
 * revocation. Allow-once decisions are never persisted.
 */
import type { PermissionGrant, PermissionsState } from '@shared/types';
import { AtomicJsonStore } from '../persistence/atomicStore';
import type { PapersPaths } from '../persistence/paths';

function validatePermissions(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) return `unsupported schemaVersion ${String(v.schemaVersion)}`;
  if (!Array.isArray(v.grants)) return 'grants is not an array';
  return null;
}

export class PermissionStore {
  private readonly store: AtomicJsonStore;
  private state: PermissionsState = { schemaVersion: 1, grants: [] };

  constructor(paths: PapersPaths) {
    this.store = new AtomicJsonStore(paths.permissionsFile, {
      recoveryDir: paths.recoveryDir,
      validate: validatePermissions,
    });
  }

  async initialize(): Promise<void> {
    const report = await this.store.load<PermissionsState>();
    this.state = report.value ?? { schemaVersion: 1, grants: [] };
  }

  hasProgramGrant(backpackId: string, programId: string, capability: string): boolean {
    return this.state.grants.some(
      (g) =>
        g.backpackId === backpackId && g.programId === programId && g.capability === capability,
    );
  }

  listGrants(): PermissionGrant[] {
    return this.state.grants.map((g) => ({ ...g }));
  }

  async grantProgram(backpackId: string, programId: string, capability: string): Promise<void> {
    if (this.hasProgramGrant(backpackId, programId, capability)) return;
    this.state.grants.push({
      backpackId,
      programId,
      capability,
      decision: 'allow-program',
      grantedAt: new Date().toISOString(),
    });
    await this.store.save(this.state);
  }

  async revoke(backpackId: string, programId: string, capability: string): Promise<boolean> {
    const before = this.state.grants.length;
    this.state.grants = this.state.grants.filter(
      (g) =>
        !(g.backpackId === backpackId && g.programId === programId && g.capability === capability),
    );
    const removed = this.state.grants.length !== before;
    if (removed) await this.store.save(this.state);
    return removed;
  }
}
