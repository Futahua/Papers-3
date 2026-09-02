import { describe, expect, it, vi } from 'vitest';

import { registerVisualSemanticKeysIpc } from '../../src/main/ipc/visualSemanticKeysIpc';
import { createVisualSemanticKeyRegistry, VISUAL_SEMANTIC_KEYS_CHANNEL } from '../../src/shared/visualSemanticKeys';

describe('visual semantic-key IPC authority', () => {
  it('accepts only the current project sender and preserves invalid-payload atomicity', () => {
    const listeners = new Map<string, (event: { sender: { id: number } }, payload: unknown) => void>();
    const registry = createVisualSemanticKeyRegistry();
    const resolveTarget = vi.fn((sender: { id: number }) => sender.id === 7
      ? { windowId: 4, surfaceId: 'surface-a' }
      : sender.id === 8 ? { windowId: 9 } : null);
    const ipcMain = {
      on(channel: string, listener: (...args: unknown[]) => void) {
        listeners.set(channel, listener as (event: { sender: { id: number } }, payload: unknown) => void);
        return ipcMain;
      },
    } as unknown as Parameters<typeof registerVisualSemanticKeysIpc>[0]['ipcMain'];
    registerVisualSemanticKeysIpc({
      ipcMain,
      resolveTarget,
      registryForTarget: (target) => target.windowId === 4 && target.surfaceId === 'surface-a' ? registry : null,
    });
    const receive = listeners.get(VISUAL_SEMANTIC_KEYS_CHANNEL)!;
    receive({ sender: { id: 7 } }, { keys: ['canvas.root'] });
    expect(registry.snapshot()).toEqual(['canvas.root']);
    receive({ sender: { id: 7 } }, { keys: ['canvas.root', 'canvas.root'] });
    expect(registry.snapshot()).toEqual(['canvas.root']);
    receive({ sender: { id: 8 } }, { keys: ['foreign'] });
    receive({ sender: { id: 99 } }, { keys: ['ignored'] });
    expect(registry.snapshot()).toEqual(['canvas.root']);
    expect(resolveTarget).toHaveBeenCalledTimes(4);
  });
});
