import { z } from 'zod';
import {
  VISUAL_SEMANTIC_KEYS_CHANNEL,
  visualSemanticKeyListSchema,
  type VisualSemanticKeyRegistry,
} from '@shared/visualSemanticKeys';
import type { IpcMain } from 'electron';
import type { VisualDiagnosticTarget } from '../visual/visualLifecycleMonitor';

const semanticKeysPayloadSchema = z.object({ keys: visualSemanticKeyListSchema }).strict();

export interface VisualSemanticKeysIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>;
  resolveTarget(sender: { id: number }): VisualDiagnosticTarget | null;
  registryForTarget(target: { windowId: number; surfaceId: string }): VisualSemanticKeyRegistry | null;
}

/** Accept only the predefined project observation payload. The sender owns
 * the exact surface; the payload contains keys only and cannot name a node. */
export function registerVisualSemanticKeysIpc(deps: VisualSemanticKeysIpcDependencies): void {
  deps.ipcMain.on(VISUAL_SEMANTIC_KEYS_CHANNEL, (event, payload) => {
    const target = deps.resolveTarget(event.sender);
    const surfaceId = target?.surfaceId;
    if (!target || !surfaceId) return;
    try {
      const parsed = semanticKeysPayloadSchema.parse(payload);
      deps.registryForTarget({ windowId: target.windowId, surfaceId })?.replaceObserved(parsed.keys);
    } catch {
      // Invalid project observations are refused without disturbing the last
      // valid snapshot or the product renderer.
    }
  });
}
