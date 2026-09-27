/**
 * Dedicated IPC registration for the window-capability service
 * (Assignment 015).
 *
 * The Backpack project bridge reaches the shared service ONLY through
 * these enumerated channels. Every invoke is gated on
 * `backpackProjectRuntime.isSender`, every input field is deeply
 * validated (unknown fields/methods are rejected, never treated as
 * commands), and every result is a typed bounded outcome. No raw send,
 * HWND, process command, path input or arbitrary launch crosses here.
 */

import { webContents, type IpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { WindowControlBroker } from '../windows/windowControlBroker';
import type { WindowObservation } from '../windows/windowCapabilityTypes';
import { defaultWindowGeometryJournal } from '../windows/windowGeometryJournal';

import {
  type PersistedWindowMemberDescriptor,
  type WindowBindResult,
  type WindowCandidateListResult,
  type WindowCapabilityService,
  type WindowInstanceSnapshot,
  type WindowResolveResult,
  type WindowRuntimeCapability,
} from '../windows/windowCapabilityService';
import {
  isValidThumbnail,
  WINDOW_THUMBNAIL_MAX_HEIGHT,
  WINDOW_THUMBNAIL_MAX_WIDTH,
  type WindowBounds,
  type WindowCapabilityResult,
} from '../windows/windowCapabilityTypes';

export const WINDOW_CAPABILITY_MAX_STRING_BYTES = 512;
export const WINDOW_CAPABILITY_MAX_BOUNDS = 32768;
/** 019GR3: a page-facing fallback error is omitted or truncated to at most
 * this many UTF-8 bytes; arbitrary internal strings are never exposed. */
export const WINDOW_THUMBNAIL_PAGE_ERROR_MAX_BYTES = 256;

/** 019G page-facing thumbnail result: exactly success
 * `{ outcome:'success', imageUrl, width, height }` or a payload-free typed
 * fallback `{ outcome }` plus optional bounded error. Never a placeholder. */
export type WindowThumbnailResult =
  | { outcome: 'success'; imageUrl: string; width: number; height: number }
  | { outcome: 'minimized' | 'missing' | 'denied' | 'malformed' | 'helper-unavailable' | 'timeout'; error?: string };

export interface WindowCapabilityIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>;
  service: WindowCapabilityService;
  isSender: (sender: WebContents) => boolean;
  waitForAuthority?: (sender: WebContents) => Promise<void>;
  /** Resolves only the trusted native host that owns this already-authorized
   * Backpack surface. The raw HWND never crosses the renderer boundary. */
  resolveCallerHwnd?: (sender: WebContents) => string | null;
  /** A project surface showing a hover preview in Papers' own always-on-top,
   * never-focused preview window instead of an in-page popover. The anchor is
   * the hovered element's screen rectangle, so the window is placed beside the
   * thing being hovered rather than beside the whole project window. */
  showProjectPreview?: (sender: WebContents, preview: {
    imageUrl: string;
    title: string;
    width: number;
    height: number;
    anchor: { x: number; y: number; width: number; height: number };
  }) => void;
  hideProjectPreview?: (senderId: number) => void;
  controlBroker?: WindowControlBroker;
  resolveControlSurface?: (sender: WebContents, rect: WindowBounds) => {
    ownerHwnd: number;
    hit: WindowBounds;
  } | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(raw).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function parseBoundedString(raw: unknown, name: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > WINDOW_CAPABILITY_MAX_STRING_BYTES) {
    throw new Error(`${name} must be a bounded non-empty string`);
  }
  return raw;
}

function parseRuntimeCapability(raw: unknown): WindowRuntimeCapability {
  if (!isPlainObject(raw)) throw new Error('capability must be an object');
  if (!exactKeys(raw, ['version', 'bindingId'])) throw new Error('capability contains unknown fields');
  if (raw['version'] !== 1) throw new Error('unsupported capability version');
  const bindingId = parseBoundedString(raw['bindingId'], 'capability.bindingId');
  return { version: 1, bindingId };
}

function parseBounds(raw: unknown): WindowBounds {
  if (!isPlainObject(raw)) throw new Error('bounds must be an object');
  const bounds: WindowBounds = { x: 0, y: 0, width: 0, height: 0 };
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`bounds.${key} must be finite`);
    bounds[key] = value;
  }
  if (!exactKeys(raw, ['x', 'y', 'width', 'height'])) throw new Error('bounds contains unknown fields');
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error('bounds width and height must be positive');
  if (bounds.width > WINDOW_CAPABILITY_MAX_BOUNDS || bounds.height > WINDOW_CAPABILITY_MAX_BOUNDS
    || Math.abs(bounds.x) > WINDOW_CAPABILITY_MAX_BOUNDS || Math.abs(bounds.y) > WINDOW_CAPABILITY_MAX_BOUNDS) {
    throw new Error('bounds exceed the allowed range');
  }
  return bounds;
}

function parsePersistedDescriptor(raw: unknown): PersistedWindowMemberDescriptor {
  if (!isPlainObject(raw)) throw new Error('descriptor must be an object');
  // A MODERN descriptor carries windowInstanceId, and this parser rejected it as
  // an unknown field while the preload's parser accepted it. One such entry made
  // the whole control sync reject before any registration began: the widget sent
  // sixteen members, the main side received zero, and the broker was never given
  // a slot. The two parsers must accept the same grammar.
  const hasWindowInstanceId = Object.prototype.hasOwnProperty.call(raw, 'windowInstanceId');
  if (!exactKeys(raw, hasWindowInstanceId
    ? ['version', 'title', 'executableFingerprint', 'windowInstanceId']
    : ['version', 'title', 'executableFingerprint'])) {
    throw new Error('descriptor contains unknown fields');
  }
  if (raw['version'] !== 1) throw new Error('unsupported descriptor version');
  const title = parseBoundedString(raw['title'], 'descriptor.title');
  const executableFingerprint = parseBoundedString(raw['executableFingerprint'], 'descriptor.executableFingerprint');
  if (!/^[a-f0-9]{64}$/i.test(executableFingerprint)) throw new Error('descriptor.executableFingerprint is invalid');
  if (hasWindowInstanceId) {
    const windowInstanceId = raw['windowInstanceId'];
    if (typeof windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(windowInstanceId)) {
      throw new Error('descriptor.windowInstanceId is invalid');
    }
    return { version: 1, title, executableFingerprint, windowInstanceId };
  }
  return { version: 1, title, executableFingerprint };
}

/** 019G thumbnail request dimensions: absent -> the 240x135 default; when
 * present they must be positive integers within the 320x180 contract bounds.
 * Unknown option keys are rejected, never ignored. */
function parseThumbnailOptions(raw: unknown): { maxWidth?: number; maxHeight?: number } {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) throw new Error('thumbnail options must be an object');
  for (const key of Object.keys(raw)) {
    if (key !== 'maxWidth' && key !== 'maxHeight') throw new Error('thumbnail options contains unknown fields');
  }
  const options: { maxWidth?: number; maxHeight?: number } = {};
  if (raw['maxWidth'] !== undefined) {
    const maxWidth = raw['maxWidth'];
    if (typeof maxWidth !== 'number' || !Number.isSafeInteger(maxWidth) || maxWidth <= 0 || maxWidth > WINDOW_THUMBNAIL_MAX_WIDTH) {
      throw new Error(`thumbnail options.maxWidth must be a positive integer at most ${WINDOW_THUMBNAIL_MAX_WIDTH}`);
    }
    options.maxWidth = maxWidth;
  }
  if (raw['maxHeight'] !== undefined) {
    const maxHeight = raw['maxHeight'];
    if (typeof maxHeight !== 'number' || !Number.isSafeInteger(maxHeight) || maxHeight <= 0 || maxHeight > WINDOW_THUMBNAIL_MAX_HEIGHT) {
      throw new Error(`thumbnail options.maxHeight must be a positive integer at most ${WINDOW_THUMBNAIL_MAX_HEIGHT}`);
    }
    options.maxHeight = maxHeight;
  }
  return options;
}

/** 019GR3: truncate a page-facing error to at most 256 UTF-8 bytes WITHOUT
 * splitting a multibyte character (an error is always either omitted or a
 * bounded string; never an arbitrary internal payload). */
function boundPageError(error: string): string {
  if (Buffer.byteLength(error, 'utf8') <= WINDOW_THUMBNAIL_PAGE_ERROR_MAX_BYTES) return error;
  let bytes = 0;
  let out = '';
  for (const character of error) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > WINDOW_THUMBNAIL_PAGE_ERROR_MAX_BYTES) break;
    bytes += characterBytes;
    out += character;
  }
  return out;
}

/** Maps the internal typed thumbnail result to the exact page result shape:
 * success carries a data-URL image plus actual dimensions; every fallback is
 * payload-free with an optional bounded error. */
function toPageThumbnailResult(result: WindowCapabilityResult): WindowThumbnailResult {
  if (result.outcome === 'success') {
    const thumbnail = result.thumbnail;
    if (!thumbnail || !isValidThumbnail(thumbnail)) {
      return { outcome: 'malformed', error: 'thumbnail response is malformed' };
    }
    return {
      outcome: 'success',
      imageUrl: `data:image/png;base64,${thumbnail.image}`,
      width: thumbnail.width,
      height: thumbnail.height,
    };
  }
  if (result.outcome === 'ambiguous') {
    // Unreachable from the thumbnail path; fail closed rather than leak it.
    return { outcome: 'malformed', error: 'thumbnail response is ambiguous' };
  }
  return { outcome: result.outcome, ...(result.error !== undefined ? { error: boundPageError(result.error) } : {}) };
}

type IpcResult = WindowCandidateListResult | WindowBindResult | WindowResolveResult | WindowCapabilityResult | WindowThumbnailResult | { snapshot: WindowInstanceSnapshot }
  | { outcome: 'success'; results: Array<{ layoutId: string; memberId: string; ready: boolean }> };

function resultPayload(result: IpcResult): IpcResult {
  return result;
}

export function registerWindowCapabilityIpc({
  ipcMain,
  service,
  isSender,
  waitForAuthority,
  resolveCallerHwnd,
  showProjectPreview,
  hideProjectPreview,
  controlBroker,
  resolveControlSurface,
}: WindowCapabilityIpcDependencies): void {
  let nativePeekActive = false;
  const lifecycleUnsubscribers = new Map<number, () => void>();
  // Preview intent: a project holds the periodic enumeration off from the moment
  // it schedules a member hover preview, so a scan cannot start during the
  // preview dwell and land in front of the capture. One hold per sender.
  const previewHolds = new Map<number, () => void>();
  const controlIds = new Map<string, number>();
  const controlFingerprints = new Map<string, string>();
  /** The geometry half of a registration, so an unchanged member is answered
   * ready without touching the helper at all. */
  const controlFingerprintGeometry = new Map<string, string>();
  const controlRegistrationsPending = new Set<string>();

  /** Registrations are BACKGROUND work and they are BOUNDED. Seventeen of them
   * fired at once and saturated the helper client's pending-request queue, so
   * every one failed with 'pending-request limit reached' - which is what left
   * the broker empty even after the sync itself worked. */
  const registrationQueue: Array<() => Promise<void>> = [];
  let registrationActive = 0;
  const REGISTRATION_CONCURRENCY = 2;
  function pumpRegistrations(): void {
    while (registrationActive < REGISTRATION_CONCURRENCY && registrationQueue.length > 0) {
      const task = registrationQueue.shift()!;
      registrationActive += 1;
      void task().catch(() => undefined).finally(() => {
        registrationActive -= 1;
        pumpRegistrations();
      });
    }
  }
  function enqueueRegistration(task: () => Promise<void>): void {
    registrationQueue.push(task);
    pumpRegistrations();
  }

  /** Resolve one member's identity into a live window and register it with the
   * resident broker. Background work: the caller has already answered. */
  async function registerControlSlot(
    sender: Electron.WebContents,
    id: number,
    key: string,
    entry: { layoutId: string; memberId: string; descriptor: PersistedWindowMemberDescriptor; restore: { x: number; y: number; width: number; height: number } | null },
    surface: { ownerHwnd: number; hit: { x: number; y: number; width: number; height: number } } | null,
  ): Promise<void> {
    const meta = controlMeta.get(id);
    const report = (result: string): void => {
      if (!meta) return;
      const live = webContents.fromId(meta.senderId);
      if (live && !live.isDestroyed()) {
        live.send('papers:window-control:event', {
          layoutId: meta.layoutId, memberId: meta.memberId, result,
        });
      }
    };
    if (!surface) { report('no-surface'); return; }
    // NO resolve, NO bind, NO second observation. The wave's ONE enumeration
    // already carries the handle, process identity, start time and class the
    // broker needs, and the broker revalidates all of them itself. Sixteen
    // per-member resolutions against a serial helper was the whole reason every
    // registration timed out while the helper sat there alive.
    // THE WATCHER'S SNAPSHOT, never a private list. The helper serves one request
    // at a time, so a registration wave that enumerates on its own competes with
    // the app's own work and loses - measured as a ten-second timeout while the
    // helper was alive. If no complete same-revision snapshot exists yet, this
    // stays PENDING instead of claiming the window is gone.
    const instanceId = entry.descriptor.windowInstanceId;
    const observation = typeof instanceId === 'string'
      ? (await service.observeInstances([instanceId]).catch(() => new Map())).get(instanceId) ?? null
      : null;
    if (!observation) { report('pending:no-snapshot'); return; }
    const restore = entry.restore ?? observation.bounds ?? null;
    const ready = !!(typeof observation.handle === 'number'
      && typeof observation.processId === 'number' && typeof observation.processStartTicks === 'string'
      && typeof observation.windowClass === 'string'
      && restore && restore.width > 0 && restore.height > 0)
      && await controlBroker!.register({
        id, hwnd: observation.handle, pid: observation.processId,
        processStartTicks: observation.processStartTicks, windowClass: observation.windowClass,
        ownerHwnd: surface.ownerHwnd, hit: surface.hit, restore: restore!,
      });
    if (ready) {
      controlFingerprints.set(key, JSON.stringify([entry.descriptor, surface, restore]));
      controlFingerprintGeometry.set(key, JSON.stringify([surface, entry.restore]));
      report('ready');
    } else {
      controlBroker!.clear(id);
      controlFingerprints.delete(key);
      controlFingerprintGeometry.delete(key);
      report('refused');
    }
  }
  const controlMeta = new Map<number, { senderId: number; layoutId: string; memberId: string; projectHost: string }>();
  const controlsBySender = new Map<number, Set<string>>();
  const controlCleanupSenders = new Set<number>();
  let nextControlId = 0;
  controlBroker?.onEvent((controlEvent) => {
    const meta = controlMeta.get(controlEvent.id);
    if (!meta) return;
    if (controlEvent.result === 'stale') {
      controlFingerprints.delete(meta.senderId + ':' + meta.layoutId + ':' + meta.memberId);
    }
    // The icon surface owns the broker slot, while the workspace owns persisted
    // layout state. Deliver the broker's result to both surfaces in this project.
    for (const recipient of webContents.getAllWebContents()) {
      if (recipient.isDestroyed()) continue;
      try {
        if (new URL(recipient.getURL()).host !== meta.projectHost) continue;
        recipient.send('papers:window-control:event', { ...controlEvent, ...meta });
      } catch { /* unrelated surfaces have no project URL */ }
    }
  });
  controlBroker?.onShift((held) => {
    for (const senderId of controlsBySender.keys()) {
      const sender = webContents.fromId(senderId);
      if (sender && !sender.isDestroyed()) sender.send('papers:window-control:shift', held);
    }
  });
  const releasePreviewHold = (senderId: number): void => {
    const release = previewHolds.get(senderId);
    if (release === undefined) return;
    previewHolds.delete(senderId);
    release();
  };
  function handle<TInput>(
    channel: string,
    parse: (raw: unknown) => TInput,
    invoke: (input: TInput, event: IpcMainInvokeEvent) => Promise<IpcResult>,
  ): void {
    handleInternal(channel, parse, invoke, true);
  }

  /** A READ-ONLY channel does not wait for document-write authority.
   *
   * The compact widget is not the writer, so `waitForAuthority` parks its request
   * indefinitely - and every channel went through it. Resolving a descriptor or an
   * instance, and listing windows, change nothing in the document: they must answer
   * whoever asks, or a surface that only needs to LOOK is starved. That starvation
   * is what left the broker with no slots at all: the widget's handle resolution
   * never returned, so no member ever became registerable.
   */
  function handleRead<TInput>(
    channel: string,
    parse: (raw: unknown) => TInput,
    invoke: (input: TInput, event: IpcMainInvokeEvent) => Promise<IpcResult>,
  ): void {
    handleInternal(channel, parse, invoke, false);
  }

  function handleInternal<TInput>(
    channel: string,
    parse: (raw: unknown) => TInput,
    invoke: (input: TInput, event: IpcMainInvokeEvent) => Promise<IpcResult>,
    needsAuthority: boolean,
  ): void {
    ipcMain.handle(channel, async (event, raw) => {
      if (needsAuthority) await waitForAuthority?.(event.sender);
      if (!isSender(event.sender)) {
        throw new Error('denied: not a Backpack project sender');
      }
      const input = parse(raw);
      return resultPayload(await invoke(input, event));
    });
  }

  handleRead('papers:window-capability:list', (raw) => {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw) || Object.keys(raw).some((key) => key !== 'includeNativeIcons')) throw new Error('list payload contains unknown fields');
    if (raw['includeNativeIcons'] !== undefined && typeof raw['includeNativeIcons'] !== 'boolean') throw new Error('includeNativeIcons must be boolean');
    return { includeNativeIcons: raw['includeNativeIcons'] !== false };
  }, (options) => service.listCandidates(options ?? { includeNativeIcons: true }));
  handleRead('papers:window-capability:lifecycle-snapshot', (raw) => {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('lifecycle snapshot payload must be empty');
    return undefined;
  }, () => service.windowLifecycleSnapshot());
  handleRead('papers:window-capability:resolve-instance', (raw) => {
    if (!isPlainObject(raw) || !exactKeys(raw, ['windowInstanceId'])
      || typeof raw['windowInstanceId'] !== 'string' || !/^W[0-9a-f]{16}$/i.test(raw['windowInstanceId'])) {
      throw new Error('window instance payload is malformed');
    }
    return raw['windowInstanceId'];
  }, (windowInstanceId) => service.resolveWindowInstance(windowInstanceId));
  handle('papers:window-capability:subscribe-lifecycle', (raw) => {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('lifecycle subscription payload must be empty');
    return undefined;
  }, async (_input, event) => {
    lifecycleUnsubscribers.get(event.sender.id)?.();
    const unsubscribe = service.watchWindowLifecycle({
      onEvent: (payload) => { if (!event.sender.isDestroyed()) event.sender.send('papers:window-lifecycle:event', payload); },
      onBaseline: (payload) => { if (!event.sender.isDestroyed()) event.sender.send('papers:window-lifecycle:baseline', payload); },
    });
    lifecycleUnsubscribers.set(event.sender.id, unsubscribe);
    event.sender.once('destroyed', () => {
      if (lifecycleUnsubscribers.get(event.sender.id) === unsubscribe) lifecycleUnsubscribers.delete(event.sender.id);
      unsubscribe();
    });
    return { outcome: 'success' };
  });
  handle('papers:window-capability:bind', (raw) => parseBoundedString(raw, 'candidateId'), (candidateId) => service.bindCandidate(candidateId));
  handleRead('papers:window-control:sync', (raw) => {
    if (!Array.isArray(raw) || raw.length > 32) throw new Error('control list exceeds the bound');
    return raw.map((entry) => {
      // A DESCRIPTOR, not a capability. The surface that renders the icons knows
      // each member's persisted identity; only Papers can turn that into a live
      // window. Asking the widget to resolve a capability first meant its request
      // was parked behind a document-write authority it does not hold, so no
      // member ever became registerable and the broker was never given a slot.
      if (!isPlainObject(entry) || !exactKeys(entry, ['layoutId', 'memberId', 'descriptor', 'rect', 'restore'])) {
        throw new Error('control entry is malformed');
      }
      const layoutId = parseBoundedString(entry['layoutId'], 'layoutId');
      const memberId = parseBoundedString(entry['memberId'], 'memberId');
      const descriptor = parsePersistedDescriptor(entry['descriptor']);
      const rect = parseBounds(entry['rect']);
      const restore = entry['restore'] === null ? null : parseBounds(entry['restore']);
      return { layoutId, memberId, descriptor, rect, restore };
    });
  }, async (entries, event) => {
    if (!controlBroker?.ready || !resolveControlSurface) {
      return { outcome: 'helper-unavailable', error: 'Native window control is unavailable' };
    }
    const old = controlsBySender.get(event.sender.id) ?? new Set<string>();
    const next = new Set<string>();
    const results: Array<{ layoutId: string; memberId: string; ready: boolean }> = [];
    for (const entry of entries) {
      const key = event.sender.id + ':' + entry.layoutId + ':' + entry.memberId;
      next.add(key);
      let id = controlIds.get(key);
      if (!id) { id = ++nextControlId; controlIds.set(key, id); }
      controlMeta.set(id, { senderId: event.sender.id, layoutId: entry.layoutId, memberId: entry.memberId,
        projectHost: new URL(event.sender.getURL()).host });
      const surface = resolveControlSurface(event.sender, entry.rect);
      // Registration is BACKGROUND work. Resolving seventeen descriptors inline
      // means seventeen enumerations, which blew the request's own timeout - so
      // the sync never answered at all and nothing was ever registered. The sync
      // now answers immediately and the answer arrives as an event per member.
      const registered = controlFingerprints.get(key);
      if (registered && controlFingerprintGeometry.get(key) === JSON.stringify([surface, entry.restore])) {
        results.push({ layoutId: entry.layoutId, memberId: entry.memberId, ready: true });
        continue;
      }
      results.push({ layoutId: entry.layoutId, memberId: entry.memberId, ready: false });
      if (!controlRegistrationsPending.has(key)) {
        controlRegistrationsPending.add(key);
        enqueueRegistration(async () => {
          try { await registerControlSlot(event.sender, id, key, entry, surface); }
          finally { controlRegistrationsPending.delete(key); }
        });
      }
    }
    for (const key of old) if (!next.has(key)) {
      const id = controlIds.get(key);
      if (id) { controlBroker.clear(id); controlMeta.delete(id); }
      controlIds.delete(key);
      controlFingerprints.delete(key);
    }
    controlsBySender.set(event.sender.id, next);
    if (!controlCleanupSenders.has(event.sender.id)) {
      controlCleanupSenders.add(event.sender.id);
      event.sender.once('destroyed', () => {
        const live = controlsBySender.get(event.sender.id);
        for (const key of live ?? []) {
          const id = controlIds.get(key);
          if (id) { controlBroker.clear(id); controlMeta.delete(id); }
          controlIds.delete(key);
          controlFingerprints.delete(key);
        }
        controlsBySender.delete(event.sender.id);
        controlCleanupSenders.delete(event.sender.id);
      });
    }
    // The page reports `resp null`, so record what THIS side returns: whether the
    // handler ran at all, and with how many members. A response that never
    // arrives is otherwise indistinguishable from one that arrives empty.
    try {
      defaultWindowGeometryJournal().record({
        kind: 'picker-open',
        detail: 'control sync: in ' + entries.length + ', out ' + results.length,
        outcome: 'success',
      });
    } catch { /* diagnostics never fail the action they describe */ }
    return { outcome: 'success', results };
  });
  handle('papers:window-control:group', (raw) => {
    if (!isPlainObject(raw) || !exactKeys(raw, ['layoutId', 'actions'])) throw new Error('group request is malformed');
    const layoutId = parseBoundedString(raw['layoutId'], 'layoutId');
    if (!Array.isArray(raw['actions']) || raw['actions'].length > 32) throw new Error('group action list is malformed');
    const actions = raw['actions'].map((value) => {
      if (!isPlainObject(value) || !exactKeys(value, ['memberId', 'operation'])) throw new Error('group action is malformed');
      const memberId = parseBoundedString(value['memberId'], 'memberId');
      const operation = value['operation'];
      if (operation !== 'minimize' && operation !== 'restore' && operation !== 'foreground' && operation !== 'toggle') throw new Error('group operation is malformed');
      return { memberId, operation: operation as 'minimize' | 'restore' | 'foreground' | 'toggle' };
    });
    return { layoutId, actions };
  }, async (request, event) => {
    const projectHost = new URL(event.sender.getURL()).host;
    const actions = request.actions.map(({ memberId, operation }) => ({
      id: controlIds.get(event.sender.id + ':' + request.layoutId + ':' + memberId)
        ?? [...controlMeta.entries()].find(([, meta]) => meta.projectHost === projectHost
          && meta.layoutId === request.layoutId && meta.memberId === memberId)?.[0],
      operation,
    }));
    if (!controlBroker?.ready || actions.some(({ id }) => !id)) return { outcome: 'helper-unavailable' };
    return { outcome: controlBroker.group(actions as Array<{ id: number; operation: 'minimize' | 'restore' | 'foreground' | 'toggle' }>)
      ? 'success' : 'helper-unavailable' };
  });
  handle('papers:window-capability:observe', parseRuntimeCapability, (capability) => service.observeCapability(capability));
  handle('papers:window-capability:minimize', parseRuntimeCapability, (capability) => service.minimizeCapability(capability));
  // One request instead of observe-then-mutate: the helper reads the live state
  // and acts on it, so no renderer round trip sits between the decision and the
  // mutation. Same opaque capability parsing as every other mutation.
  handle('papers:window-capability:toggle', parseRuntimeCapability, (capability) => service.toggleCapability(capability));
  // Bring a window to the front. Papers makes this call in its own process and
  // reports success only when the foreground actually moved, so "did it come
  // forward" is a fact rather than an assumption.
  handle('papers:window-capability:activate', parseRuntimeCapability, (capability) => service.activateCapability(capability));  handle('papers:window-capability:restore', parseRuntimeCapability, (capability) => service.restoreCapability(capability));
  handle('papers:window-capability:close', parseRuntimeCapability, (capability) => service.closeCapability(capability));
  handle('papers:window-capability:end-process', parseRuntimeCapability, (capability) => service.endProcessCapability(capability));
  handle('papers:window-capability:peek-begin', parseRuntimeCapability, async (capability, event) => {
    const caller = resolveCallerHwnd?.(event.sender) ?? null;
    if (caller && service.beginLivePreviewCapability) {
      // A failed/late begin can still have taken effect in DWM. Keep the
      // release route armed until a confirmed end succeeds.
      nativePeekActive = true;
      const result = await service.beginLivePreviewCapability(capability, caller);
      return result;
    }
    nativePeekActive = false;
    return service.beginPeekCapability(capability);
  });
  handle('papers:window-capability:peek-end', (raw) => {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('peek-end payload must be empty');
    return undefined;
  }, async () => {
    if (nativePeekActive && service.endLivePreview) {
      const result = await service.endLivePreview();
      if (result.outcome === 'success') nativePeekActive = false;
      return result;
    }
    return service.endPeek();
  });
  handle(
    'papers:window-capability:apply',
    (raw) => {
      if (!isPlainObject(raw)) throw new Error('apply payload must be an object');
      const keys = Object.keys(raw);
      if (keys.length !== 2 || !keys.includes('capability') || !keys.includes('bounds')) {
        throw new Error('apply payload must contain exactly capability and bounds');
      }
      const capability = parseRuntimeCapability(raw['capability']);
      const bounds = parseBounds(raw['bounds']);
      return { capability, bounds };
    },
    (input) => service.applyCapability(input.capability, input.bounds),
  );
  handle(
    'papers:window-capability:preview-show',
    (raw) => {
      if (!isPlainObject(raw)) throw new Error('preview payload must be an object');
      const keys = Object.keys(raw).sort();
      const expected = ['anchor', 'height', 'imageUrl', 'title', 'width'].sort();
      if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
        throw new Error('preview payload must contain exactly imageUrl, title, width, height and anchor');
      }
      const imageUrl = raw['imageUrl'];
      const title = raw['title'];
      const width = raw['width'];
      const height = raw['height'];
      const anchor = raw['anchor'];
      if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/') || imageUrl.length > 512 * 1024) {
        throw new Error('preview image must be a bounded data URL');
      }
      if (typeof title !== 'string' || Buffer.byteLength(title, 'utf8') > 512) throw new Error('preview title is malformed');
      if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1
        || (width as number) > 640 || (height as number) > 480) {
        throw new Error('preview dimensions are out of range');
      }
      if (!isPlainObject(anchor)) throw new Error('preview anchor must be an object');
      const numbers = ['x', 'y', 'width', 'height'].map((key) => anchor[key]);
      if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('preview anchor must be finite numbers');
      }
      return {
        imageUrl,
        title,
        width: width as number,
        height: height as number,
        anchor: {
          x: numbers[0] as number,
          y: numbers[1] as number,
          width: numbers[2] as number,
          height: numbers[3] as number,
        },
      };
    },
    (_input, event) => {
      showProjectPreview?.(event.sender, _input);
      return Promise.resolve({ outcome: 'success' });
    },
  );
  handle(
    'papers:window-capability:preview-hide',
    (raw) => {
      if (raw === undefined) return undefined;
      if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('preview hide payload must be empty');
      return undefined;
    },
    (_input, event) => {
      hideProjectPreview?.(event.sender.id);
      return Promise.resolve({ outcome: 'success' });
    },
  );
  handleRead('papers:window-capability:resolve', parsePersistedDescriptor, (descriptor) => service.resolvePersisted(descriptor));
  handle(
    'papers:window-capability:preview-hold',
    (raw) => {
      if (raw === undefined) return undefined;
      if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('preview hold payload must be empty');
      return undefined;
    },
    (_input, event) => {
      if (!previewHolds.has(event.sender.id)) {
        previewHolds.set(event.sender.id, service.holdWindowLifecycleRefresh().release);
        // A project that goes away mid-hover must not strand the hold.
        event.sender.once('destroyed', () => releasePreviewHold(event.sender.id));
      }
      return Promise.resolve({ outcome: 'success' });
    },
  );
  handle(
    'papers:window-capability:preview-release',
    (raw) => {
      if (raw === undefined) return undefined;
      if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('preview release payload must be empty');
      return undefined;
    },
    (_input, event) => {
      releasePreviewHold(event.sender.id);
      return Promise.resolve({ outcome: 'success' });
    },
  );
  handle(
    'papers:window-capability:thumbnail',
    (raw) => {
      if (!isPlainObject(raw)) throw new Error('thumbnail payload must be an object');
      if (!exactKeys(raw, ['capability', 'options'])) {
        throw new Error('thumbnail payload must contain exactly capability and options');
      }
      const capability = parseRuntimeCapability(raw['capability']);
      const options = parseThumbnailOptions(raw['options']);
      return { capability, options };
    },
    async (input) => toPageThumbnailResult(await service.thumbnailCapability(input.capability, input.options)),
  );
}
