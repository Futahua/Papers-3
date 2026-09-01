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

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

import {
  type PersistedWindowMemberDescriptor,
  type WindowBindResult,
  type WindowCandidateListResult,
  type WindowCapabilityService,
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
  if (!exactKeys(raw, ['version', 'title', 'executableFingerprint'])) throw new Error('descriptor contains unknown fields');
  if (raw['version'] !== 1) throw new Error('unsupported descriptor version');
  const title = parseBoundedString(raw['title'], 'descriptor.title');
  const executableFingerprint = parseBoundedString(raw['executableFingerprint'], 'descriptor.executableFingerprint');
  if (!/^[a-f0-9]{64}$/i.test(executableFingerprint)) throw new Error('descriptor.executableFingerprint is invalid');
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

type IpcResult = WindowCandidateListResult | WindowBindResult | WindowResolveResult | WindowCapabilityResult | WindowThumbnailResult;

function resultPayload(result: IpcResult): IpcResult {
  return result;
}

export function registerWindowCapabilityIpc({
  ipcMain,
  service,
  isSender,
  waitForAuthority,
  resolveCallerHwnd,
}: WindowCapabilityIpcDependencies): void {
  let nativePeekActive = false;
  function handle<TInput>(
    channel: string,
    parse: (raw: unknown) => TInput,
    invoke: (input: TInput, event: IpcMainInvokeEvent) => Promise<IpcResult>,
  ): void {
    ipcMain.handle(channel, async (event, raw) => {
      await waitForAuthority?.(event.sender);
      if (!isSender(event.sender)) {
        throw new Error('denied: not a Backpack project sender');
      }
      const input = parse(raw);
      return resultPayload(await invoke(input, event));
    });
  }

  handle('papers:window-capability:list', (raw) => {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw) || Object.keys(raw).length !== 0) throw new Error('list payload must be empty');
    return undefined;
  }, () => service.listCandidates({ includeNativeIcons: true }));
  handle('papers:window-capability:bind', (raw) => parseBoundedString(raw, 'candidateId'), (candidateId) => service.bindCandidate(candidateId));
  handle('papers:window-capability:observe', parseRuntimeCapability, (capability) => service.observeCapability(capability));
  handle('papers:window-capability:minimize', parseRuntimeCapability, (capability) => service.minimizeCapability(capability));
  handle('papers:window-capability:restore', parseRuntimeCapability, (capability) => service.restoreCapability(capability));
  handle('papers:window-capability:close', parseRuntimeCapability, (capability) => service.closeCapability(capability));
  handle('papers:window-capability:peek-begin', parseRuntimeCapability, async (capability, event) => {
    const caller = resolveCallerHwnd?.(event.sender) ?? null;
    if (caller && service.beginLivePreviewCapability) {
      const result = await service.beginLivePreviewCapability(capability, caller);
      nativePeekActive = result.outcome === 'success';
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
      nativePeekActive = false;
      return service.endLivePreview();
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
  handle('papers:window-capability:resolve', parsePersistedDescriptor, (descriptor) => service.resolvePersisted(descriptor));
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
