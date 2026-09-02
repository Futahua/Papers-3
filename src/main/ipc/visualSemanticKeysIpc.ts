import { z } from 'zod';
import {
  VISUAL_SEMANTIC_KEYS_CHANNEL,
  visualSemanticKeyListSchema,
  type VisualSemanticKeyRegistry,
} from '@shared/visualSemanticKeys';
import type { IpcMain } from 'electron';
import type { VisualDiagnosticTarget } from '../visual/visualLifecycleMonitor';

const semanticKeysPayloadSchema = z.object({
  keys: visualSemanticKeyListSchema,
  documentInstanceId: z.string().uuid().optional(),
}).strict();

export interface VisualSemanticKeysIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>;
  resolveTarget(sender: { id: number }): VisualDiagnosticTarget | null;
  registryForTarget(target: { windowId: number; surfaceId: string }, senderId: number): VisualSemanticKeyRegistry | null;
  onObserved?(target: { windowId: number; surfaceId: string }, senderId: number, keys: string[]): void;
  isCurrentDocumentInstance?(target: { windowId: number; surfaceId: string }, senderId: number, documentInstanceId: string): boolean;
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
      if (deps.isCurrentDocumentInstance
        && (!parsed.documentInstanceId || !deps.isCurrentDocumentInstance(
          { windowId: target.windowId, surfaceId }, event.sender.id, parsed.documentInstanceId))) {
        return;
      }
      const registry = deps.registryForTarget({ windowId: target.windowId, surfaceId }, event.sender.id);
      if (!registry) return;
      registry.replaceObserved(parsed.keys);
      deps.onObserved?.({ windowId: target.windowId, surfaceId }, event.sender.id, parsed.keys);
    } catch {
      // Invalid project observations are refused without disturbing the last
      // valid snapshot or the product renderer.
    }
  });
}
