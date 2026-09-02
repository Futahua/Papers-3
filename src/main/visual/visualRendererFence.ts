import type { IpcMain, WebContents } from 'electron';

import { VISUAL_FENCE_REQUEST_CHANNEL, VISUAL_FENCE_RESPONSE_CHANNEL } from '@shared/visualSemanticKeyConstants';

interface FenceResponse {
  requestId: string;
  ready: true;
}

interface PendingFence {
  senderId: number;
  resolve: (ready: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface VisualRendererFenceService {
  request(contents: WebContents, requestId: string, timeoutMs?: number): Promise<boolean>;
}

function validResponse(payload: unknown): payload is FenceResponse {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  return typeof value['requestId'] === 'string'
    && value['requestId'].length > 0 && value['requestId'].length <= 128
    && value['ready'] === true;
}

/** Fixed renderer liveness fence. The renderer may answer only with the
 * fresh request id and a bounded readiness bit; no page script or caller
 * selector crosses this boundary. */
export function createVisualRendererFenceService(
  ipcMain: Pick<IpcMain, 'on'>,
): VisualRendererFenceService {
  const pending = new Map<string, PendingFence>();
  ipcMain.on(VISUAL_FENCE_RESPONSE_CHANNEL, (event, payload) => {
    if (!validResponse(payload)) return;
    const waiting = pending.get(payload.requestId);
    if (!waiting || waiting.senderId !== event.sender.id) return;
    pending.delete(payload.requestId);
    clearTimeout(waiting.timer);
    waiting.resolve(true);
  });

  return {
    request(contents, requestId, timeoutMs = 1000) {
      if (contents.isDestroyed() || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve(false);
        }, timeoutMs);
        pending.set(requestId, { senderId: contents.id, resolve, timer });
        try {
          contents.send(VISUAL_FENCE_REQUEST_CHANNEL, { requestId });
        } catch {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(false);
        }
      });
    },
  };
}
