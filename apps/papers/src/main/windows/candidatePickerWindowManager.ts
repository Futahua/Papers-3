import { BrowserWindow, ipcMain as electronIpcMain, screen as electronScreen, type IpcMain, type WebContents } from 'electron';

import { createCandidatePickerDelivery, type CandidatePickerDeliveryResult } from './candidatePickerDelivery';
import { buildCandidatePickerDocument, type CandidatePickerDocumentRow } from './candidatePickerDocument';
import {
  parseCandidatePickerNavigation,
  parseCandidatePickerSignal,
  type CandidatePickerIntent,
} from './candidatePickerSignal';
import { createWindowCandidatePeekController } from './windowCandidatePeekController';
import type { WindowCapabilityService } from './windowCapabilityService';

export type CandidatePickerResult = {
  action: 'select' | 'close' | 'cancel' | 'direct-pick';
  candidateId: string | null;
};

type PickerCandidate = CandidatePickerDocumentRow;

type CandidatePickerSession = {
  window: BrowserWindow;
  pickerId: string;
  candidateIds: Set<string>;
  documentReady: boolean;
  delivery?: ReturnType<typeof createCandidatePickerDelivery<PickerCandidate>>;
  resolve: ((result: CandidatePickerResult) => void) | null;
  dismiss?: () => void;
};

export interface CandidatePickerWindowManagerOptions {
  preloadPath: string;
  service: WindowCapabilityService;
  ipc?: Pick<IpcMain, 'on' | 'removeListener'>;
  screen?: Pick<typeof electronScreen, 'getCursorScreenPoint' | 'getDisplayNearestPoint'>;
  createWindow?: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Owns native candidate-picker window/session lifecycle.
 *
 * It deliberately consumes WindowCapabilityService instead of owning native
 * window identity or persistence authority. The picker is presentation +
 * bounded selection/peek interaction; the semantic capability service remains
 * the source of truth for candidate binding and preview release.
 */
export function createCandidatePickerWindowManager(options: CandidatePickerWindowManagerOptions) {
  const service = options.service;
  const ipc = options.ipc ?? electronIpcMain;
  const screen = options.screen ?? electronScreen;
  const createWindow = options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions));
  const now = options.now ?? Date.now;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  const sessions = new Map<number, CandidatePickerSession>();

  const makeDelivery = (senderId: number, session: CandidatePickerSession) =>
    createCandidatePickerDelivery<PickerCandidate>(async (candidates) => {
      if (sessions.get(senderId) !== session || session.window.isDestroyed()) return false;
      const update = JSON.stringify(candidates).replace(/</g, '\\u003c');
      const applied = await session.window.webContents.executeJavaScript(
        `typeof window.__papersPickerUpdate === 'function' && (window.__papersPickerUpdate(${update}), true)`,
        true,
      );
      return applied === true && sessions.get(senderId) === session && !session.window.isDestroyed();
    });

  async function dismiss(sender: WebContents): Promise<void> {
    const active = sessions.get(sender.id);
    if (!active || active.window.isDestroyed()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeoutFn(() => reject(new Error('window chooser did not close')), 8000);
      active.window.once('closed', () => {
        clearTimeoutFn(timer);
        resolve();
      });
      active.dismiss?.();
    });
  }

  async function show(
    sender: WebContents,
    candidates: PickerCandidate[],
    pickerId: string,
  ): Promise<CandidatePickerResult> {
    const active = sessions.get(sender.id);
    if (active && !active.window.isDestroyed()) {
      if (active.pickerId !== pickerId) {
        active.resolve?.({ action: 'cancel', candidateId: null });
        active.delivery?.close();
        active.pickerId = pickerId;
        active.delivery = makeDelivery(sender.id, active);
        if (active.documentReady) await active.delivery.markReady();
      }
      active.pickerId = pickerId;
      active.candidateIds = new Set(candidates.map((candidate) => candidate.id));
      const delivered = await active.delivery!.update(candidates);
      if (delivered === 'failed' || delivered === 'stale') {
        return { action: 'cancel', candidateId: null };
      }
      if (!active.window.isVisible()) active.window.show();
      active.window.focus();
      return new Promise<CandidatePickerResult>((resolve) => {
        active.resolve?.({ action: 'cancel', candidateId: null });
        active.resolve = resolve;
      });
    }

    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const width = Math.min(420, area.width);
    const height = Math.min(440, area.height);
    const x = Math.max(area.x, Math.min(area.x + area.width - width, cursor.x - Math.round(width / 2)));
    const y = Math.max(area.y, Math.min(area.y + area.height - height, cursor.y - 36));
    const picker = createWindow({
      title: 'Papers Window Chooser',
      x,
      y,
      width,
      height,
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#161b22',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: options.preloadPath,
      },
    });
    picker.setAlwaysOnTop(true, 'pop-up-menu');

    const lifecycleHold = service.holdWindowLifecycleRefresh();
    picker.once('closed', lifecycleHold.release);
    const html = buildCandidatePickerDocument(candidates);

    return new Promise<CandidatePickerResult>((resolve) => {
      const pickerOpenedAt = now();
      let pickerPointerEntered = false;
      let pickerOutsideSince: number | null = null;
      let pickerPointerWatch: NodeJS.Timeout | null = null;
      let peekGeneration = 0;
      let peekTimer: NodeJS.Timeout | null = null;
      let peekEndTimer: NodeJS.Timeout | null = null;
      const nativeHandle = picker.getNativeWindowHandle();
      const callerHwnd = nativeHandle.length >= 8
        ? nativeHandle.readBigUInt64LE(0).toString()
        : String(nativeHandle.readUInt32LE(0));
      const peekController = createWindowCandidatePeekController({
        endLivePreview: service.endLivePreview,
        endPeek: () => service.endPeek(),
      });
      let actionFinishing = false;
      let pickerClosing = false;
      let pickerReleaseConfirmed = false;

      const endCandidatePeek = (): Promise<boolean> => {
        peekGeneration += 1;
        if (peekTimer) { clearTimeoutFn(peekTimer); peekTimer = null; }
        if (peekEndTimer) { clearTimeoutFn(peekEndTimer); peekEndTimer = null; }
        return peekController.end();
      };
      const beginCandidatePeek = (candidateId: string): void => {
        if (process.env['PAPERS_DISABLE_LIST_PEEK'] === '1') return;
        if (actionFinishing || pickerClosing) return;
        if (peekEndTimer) { clearTimeoutFn(peekEndTimer); peekEndTimer = null; }
        if (peekTimer) clearTimeoutFn(peekTimer);
        const generation = ++peekGeneration;
        peekTimer = setTimeoutFn(() => {
          peekTimer = null;
          peekController.begin(async () => {
            const bound = await service.bindCandidate(candidateId);
            if (generation !== peekGeneration || bound.outcome !== 'success') return { outcome: 'missing' };
            return service.beginLivePreviewCapability
              ? service.beginLivePreviewCapability(bound.capability, callerHwnd)
              : { outcome: 'helper-unavailable' };
          });
        }, 32);
        peekTimer.unref?.();
      };
      const deferCandidatePeekEnd = (): void => {
        if (peekEndTimer) clearTimeoutFn(peekEndTimer);
        peekEndTimer = setTimeoutFn(() => { void endCandidatePeek(); }, 80);
        peekEndTimer.unref?.();
      };

      const session: CandidatePickerSession = {
        window: picker,
        pickerId,
        candidateIds: new Set(candidates.map((candidate) => candidate.id)),
        documentReady: false,
        resolve,
      };
      session.delivery = makeDelivery(sender.id, session);
      sessions.set(sender.id, session);

      const finishAction = (action: 'select' | 'close', candidateId: string): void => {
        const current = sessions.get(sender.id);
        if (!current || current.window !== picker || !current.resolve || actionFinishing) return;
        actionFinishing = true;
        void endCandidatePeek().then((released) => {
          const latest = sessions.get(sender.id);
          if (!latest || latest.window !== picker || !latest.resolve) return;
          const settle = latest.resolve;
          latest.resolve = null;
          settle(released ? { action, candidateId } : { action: 'cancel', candidateId: null });
        });
      };
      const finishDirectPick = (): void => {
        const current = sessions.get(sender.id);
        if (!current || current.window !== picker || !current.resolve || actionFinishing) return;
        actionFinishing = true;
        void endCandidatePeek().then((released) => {
          const latest = sessions.get(sender.id);
          if (!latest || latest.window !== picker || !latest.resolve) return;
          const settle = latest.resolve;
          latest.resolve = null;
          settle(released
            ? { action: 'direct-pick', candidateId: null }
            : { action: 'cancel', candidateId: null });
        });
      };
      const closePicker = (): void => {
        const current = sessions.get(sender.id);
        if (!current || current.window !== picker || pickerClosing) return;
        pickerClosing = true;
        void endCandidatePeek().then((released) => {
          if (!released) {
            pickerClosing = false;
            if (!picker.isDestroyed()) setTimeoutFn(closePicker, 250);
            return;
          }
          const latest = sessions.get(sender.id);
          if (!latest || latest.window !== picker) return;
          sessions.delete(sender.id);
          const settle = latest.resolve;
          latest.resolve = null;
          settle?.({ action: 'cancel', candidateId: null });
          pickerReleaseConfirmed = true;
          if (!picker.isDestroyed()) picker.destroy();
        }).catch(() => { pickerClosing = false; });
      };
      session.dismiss = closePicker;
      sender.once('destroyed', closePicker);
      picker.on('close', (event) => {
        if (pickerReleaseConfirmed) return;
        event.preventDefault();
        closePicker();
      });

      pickerPointerWatch = setIntervalFn(() => {
        if (picker.isDestroyed()) return;
        const point = screen.getCursorScreenPoint();
        const bounds = picker.getBounds();
        const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width
          && point.y >= bounds.y && point.y < bounds.y + bounds.height;
        if (inside) {
          pickerPointerEntered = true;
          pickerOutsideSince = null;
          return;
        }
        const currentTime = now();
        if (!pickerPointerEntered && currentTime - pickerOpenedAt < 650) return;
        pickerOutsideSince ??= currentTime;
        if (currentTime - pickerOutsideSince >= 140) closePicker();
      }, 40);
      pickerPointerWatch.unref?.();

      const handleIntent = (intent: CandidatePickerIntent): void => {
        if (intent.action === 'cancel') { closePicker(); return; }
        if (intent.action === 'direct-pick') { finishDirectPick(); return; }
        if (intent.action === 'peek-end') { deferCandidatePeekEnd(); return; }
        if (intent.action === 'peek') { beginCandidatePeek(intent.candidateId); return; }
        if (intent.action === 'select' || intent.action === 'close') {
          finishAction(intent.action, intent.candidateId);
        }
      };
      picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const pickerSignal = (event: Electron.IpcMainEvent, raw: unknown): void => {
        if (event.sender.id !== picker.webContents.id) return;
        const intent = parseCandidatePickerSignal(raw, session.candidateIds);
        if (intent) handleIntent(intent);
      };
      ipc.on('papers:candidate-picker:signal', pickerSignal);
      picker.webContents.on('will-navigate', (event, target) => {
        event.preventDefault();
        const intent = parseCandidatePickerNavigation(target, session.candidateIds);
        if (intent) handleIntent(intent);
      });
      picker.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') {
          event.preventDefault();
          closePicker();
        }
      });
      picker.once('closed', () => {
        session.delivery?.close();
        lifecycleHold.release();
        if (pickerPointerWatch) {
          clearIntervalFn(pickerPointerWatch);
          pickerPointerWatch = null;
        }
        ipc.removeListener('papers:candidate-picker:signal', pickerSignal);
        const current = sessions.get(sender.id);
        if (!current || current.window !== picker) return;
        sessions.delete(sender.id);
        void endCandidatePeek();
        const settle = current.resolve;
        current.resolve = null;
        settle?.({ action: 'cancel', candidateId: null });
      });
      picker.once('ready-to-show', () => {
        if (picker.isDestroyed()) return;
        picker.show();
        picker.focus();
      });
      picker.webContents.once('did-finish-load', () => {
        const current = sessions.get(sender.id);
        if (current !== session || picker.isDestroyed()) return;
        session.documentReady = true;
        void session.delivery?.markReadyWithRetry().then((result) => {
          if (result === 'failed' && sessions.get(sender.id) === session) closePicker();
        });
      });
      void picker.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
        .catch(() => closePicker());
    });
  }

  async function update(
    sender: WebContents,
    candidates: PickerCandidate[],
    pickerId: string,
  ): Promise<CandidatePickerDeliveryResult> {
    const active = sessions.get(sender.id);
    if (!active || active.pickerId !== pickerId || active.window.isDestroyed()) return 'stale';
    active.candidateIds = new Set(candidates.map((candidate) => candidate.id));
    return active.delivery!.update(candidates);
  }

  function dispose(): void {
    for (const session of [...sessions.values()]) session.dismiss?.();
  }

  return { show, update, dismiss, dispose };
}

export type CandidatePickerWindowManager = ReturnType<typeof createCandidatePickerWindowManager>;
