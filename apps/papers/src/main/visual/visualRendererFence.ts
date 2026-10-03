import type { IpcMain, WebContents } from 'electron';

import { VISUAL_FENCE_REQUEST_CHANNEL, VISUAL_FENCE_RESPONSE_CHANNEL } from '@shared/visualSemanticKeyConstants';

interface FenceResponse {
  requestId: string;
  documentInstanceId: string;
  ready: true;
}

interface PendingFence {
  senderId: number;
  documentInstanceId: string;
  resolve: (ready: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface VisualRendererFenceService {
  request(contents: WebContents, requestId: string, documentInstanceId: string, timeoutMs?: number): Promise<boolean>;
}

function validResponse(payload: unknown): payload is FenceResponse {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  return typeof value['requestId'] === 'string'
    && value['requestId'].length > 0 && value['requestId'].length <= 128
    && typeof value['documentInstanceId'] === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value['documentInstanceId'])
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
    if (!waiting || waiting.senderId !== event.sender.id || waiting.documentInstanceId !== payload.documentInstanceId) return;
    pending.delete(payload.requestId);
    clearTimeout(waiting.timer);
    waiting.resolve(true);
  });

  return {
    request(contents, requestId, documentInstanceId, timeoutMs = 1000) {
      if (contents.isDestroyed() || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve(false);
        }, timeoutMs);
        pending.set(requestId, { senderId: contents.id, documentInstanceId, resolve, timer });
        try {
          contents.send(VISUAL_FENCE_REQUEST_CHANNEL, { requestId, documentInstanceId });
        } catch {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(false);
        }
      });
    },
  };
}
