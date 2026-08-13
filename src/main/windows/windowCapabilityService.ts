/**
 * Shared bounded window-capability service (Assignment 015).
 *
 * The single main-process owner of the 014 window-helper factory for the
 * Backpack project bridge. It exposes ONLY a narrow typed surface:
 *   - list eligible candidates (only the explicitly admitted main Papers
 *     shell may be same-process; utility surfaces and untrusted entries are
 *     excluded host-side; results are bounded),
 *   - bind one currently listed, host-issued candidate id into an
 *     ephemeral runtime capability plus a versioned persisted descriptor,
 *   - observe / minimize / restore / apply bounds for one issued
 *     capability,
 *   - 019G real-window thumbnail for one issued capability (bounded
 *     PrintWindow capture behind a short duplicate-request cache),
 *   - fail-closed re-resolution of an already-visible window from a
 *     persisted descriptor (zero matches = missing, multiple = ambiguous;
 *     a descriptor is NEVER authority to execute or launch anything).
 *
 * There is no close, no raw send, no HWND/process-command/path input and
 * no arbitrary launch anywhere in this surface.
 *
 * Bounds: candidate count, title/icon cache sizes, pending calls,
 * subscription count and observation cadence are all capped; icon
 * enrichment uses main-process app.getFileIcon ONLY on a path the helper
 * reported, cached/deduplicated by process identity. The factory starts
 * lazily on first capability use, restarts on crash, and the service
 * stop()s it on owned shutdown.
 */

import { createWindowHelperFactory, type WindowHelperFactory } from './windowHelperFactory';
import { createHash } from 'node:crypto';
import {
  createThumbnailFrameStore,
  pngDimensions,
  thumbnailDescriptorKey,
  type ThumbnailFrameStore,
} from './thumbnailFrameStore';
import {
  isValidThumbnail,
  WINDOW_THUMBNAIL_MAX_HEIGHT,
  WINDOW_THUMBNAIL_MAX_WIDTH,
  type RuntimeWindowId,
  type WindowBounds,
  type WindowCapabilityResult,
  type WindowObservation,
  type WindowState,
} from './windowCapabilityTypes';

export const WINDOW_CAPABILITY_MAX_CANDIDATES = 64;
export const WINDOW_CAPABILITY_MAX_ICON_CACHE = 64;
export const WINDOW_CAPABILITY_MAX_SUBSCRIBERS = 8;
export const WINDOW_CAPABILITY_OBSERVE_CADENCE_MS = 500;
export const WINDOW_CAPABILITY_MAX_TITLE_BYTES = 256;
/** The capability client timeout: the helper's first desktop enumeration is
 * slow (every visible top-level window is read), so the default 2s client
 * timeout would fail the very first list. Bounded and generous. */
export const WINDOW_CAPABILITY_CLIENT_TIMEOUT_MS = 10000;
/** Direct-pick hover points are bounded to a sane multi-monitor range. */
export const WINDOW_CAPABILITY_PICK_POINT_RANGE = 65536;
/** 019G thumbnail cache: a duplicate-request shield ONLY (maximum 750 ms TTL,
 * maximum 8 entries), never a long-lived screenshot store. Cache misses are
 * captured live on hover; leaving/canceling discards late responses. */
export const WINDOW_CAPABILITY_THUMBNAIL_MAX_CACHE = 8;
export const WINDOW_CAPABILITY_THUMBNAIL_TTL_MS = 750;
export const WINDOW_CAPABILITY_THUMBNAIL_DEFAULT_WIDTH = 240;
/** 028 P3 capture-before-minimize registration: minimum interval between
 * background frame seeds for one binding (bounded). */
export const FRAME_SEED_MIN_INTERVAL_MS = 30000;
export const WINDOW_CAPABILITY_THUMBNAIL_DEFAULT_HEIGHT = 135;

export interface WindowCandidate {
  /** Host-issued opaque candidate id; never a helper token or HWND. */
  id: string;
  title: string;
  applicationLabel: string;
  icon: string | null;
  state: WindowState;
}

/** Stable, persisted-safe member identity for fail-closed re-resolution of
 * an ALREADY VISIBLE window. Deliberately contains no runtime id, token,
 * HWND or executable authority. */
export interface PersistedWindowMemberDescriptor {
  version: 1;
  executableFingerprint?: string;
  title: string;
}

/** Ephemeral runtime capability: never persisted, never reconstructed from
 * a descriptor. */
export interface WindowRuntimeCapability {
  version: 1;
  bindingId?: string;
}

export type WindowCandidateListResult =
  | { outcome: 'success'; candidates: WindowCandidate[] }
  | { outcome: 'helper-unavailable'; error?: string };

/** 016 direct-pick hover: the topmost task-worthy candidate at a point, or
 * null when nothing eligible is there. Identity is host-issued and STABLE
 * per window (derived from the helper-session token, which the helper
 * reuses for an unchanged identity), so a click can be authorized against
 * the exact highlighted candidate and fails closed when it changes. `bounds`
 * (current rectangle) and `descriptor` (persisted-identity shape) are
 * consumed only by the main-owned pick overlay/session; they are never sent
 * to Backpack content. */
export type WindowHoverResult =
  | { outcome: 'success'; candidate: WindowCandidate | null; bounds: WindowBounds | null; descriptor: PersistedWindowMemberDescriptor | null }
  | { outcome: 'missing' | 'helper-unavailable' | 'timeout'; error?: string };

export type WindowBindResult =
  | { outcome: 'success'; capability: WindowRuntimeCapability; descriptor: PersistedWindowMemberDescriptor }
  | { outcome: 'missing' | 'helper-unavailable' | 'timeout'; error?: string };

export type WindowResolveResult =
  | { outcome: 'success'; capability: WindowRuntimeCapability; descriptor: PersistedWindowMemberDescriptor }
  | { outcome: 'missing' | 'ambiguous' | 'helper-unavailable' | 'timeout'; error?: string };

export interface WindowMemberUpdate {
  state: WindowState;
  bounds: WindowBounds | null;
}

/** Machine-local identity used only at the SlopTop picker boundary. It is
 * deliberately non-persistable: AHK uses the PID + current visible rectangle
 * to seed and return its local green set, then Papers immediately resolves it
 * back into ordinary capabilities/descriptors. */
export interface NativePickerWindowIdentity extends WindowBounds {
  processId: number;
}

export type NativePickerSeedResult =
  | { outcome: 'success'; seeds: NativePickerWindowIdentity[] }
  | { outcome: 'missing' | 'ambiguous' | 'helper-unavailable' | 'timeout'; error?: string };

export type NativePickerBindResult =
  | { outcome: 'success'; windows: Array<{ descriptor: PersistedWindowMemberDescriptor; capability: WindowRuntimeCapability; candidate: WindowCandidate }> }
  | { outcome: 'missing' | 'ambiguous' | 'helper-unavailable' | 'timeout'; error?: string };

export interface WindowCapabilityService {
  listCandidates(options?: { includeNativeIcons?: boolean }): Promise<WindowCandidateListResult>;
  bindCandidate(candidateId: string): Promise<WindowBindResult>;
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  minimizeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  restoreCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  /** Explicit Ctrl+middle-click action. Closes only the exact verified window;
   * sibling windows owned by the same process remain untouched. */
  closeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  /** Transient taskbar-style Peek: compositor-cloak every currently visible
   * eligible window except the target, then uncloak exactly that set on end. */
  beginPeekCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  endPeek(): Promise<WindowCapabilityResult>;
  /** Native taskbar-style DWM live preview used by the candidate list. The
   * caller HWND is Papers-owned and never supplied by project content. */
  beginLivePreviewCapability?(capability: WindowRuntimeCapability, caller: string): Promise<WindowCapabilityResult>;
  endLivePreview?(): Promise<WindowCapabilityResult>;
  applyCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult>;
  /** 019G real-window thumbnail for one issued capability. Dimensions default
   * to 240x135, must be positive integers within 320x180 (malformed
   * otherwise); the helper rechecks exact token identity immediately before
   * capture and PrintWindow is best effort, so `minimized`/`missing`/`denied`
   * are honest typed fallbacks. The bounded result is cached as a
   * duplicate-request shield (TTL <= 750 ms, LRU <= 8) and only after strict
   * validation. */
  thumbnailCapability(
    capability: WindowRuntimeCapability,
    options?: { maxWidth?: number; maxHeight?: number },
  ): Promise<WindowCapabilityResult>;
  resolvePersisted(descriptor: PersistedWindowMemberDescriptor): Promise<WindowResolveResult>;
  /** 016 direct pick: resolve the topmost task-worthy candidate at a screen
   * point. Candidate ids are stable per window identity. */
  hoverAt(x: number, y: number): Promise<WindowHoverResult>;
  /** 016 direct pick: re-resolve at the point and bind the candidate ONLY
   * when it is still the exact highlighted one (fail closed otherwise). */
  pickAt(x: number, y: number, candidateId: string): Promise<WindowBindResult & { candidate?: WindowCandidate }>;
  /** SlopTop local picker: resolve every currently visible member in one helper
   * snapshot before activation. Closed/stale members are omitted from the green
   * seed set instead of blocking the whole picker. No HWND or helper token
   * crosses this boundary. */
  prepareNativePicker(memberDescriptors: PersistedWindowMemberDescriptor[]): Promise<NativePickerSeedResult>;
  /** SlopTop local picker: bind one final AHK-owned green-set snapshot in one
   * helper enumeration. Every identity must match exactly once or the complete
   * commit fails closed. */
  bindNativePickerSelection(selections: NativePickerWindowIdentity[]): Promise<NativePickerBindResult>;
  stop(): Promise<void>;
}

export interface WindowCapabilityServiceOptions {
  /** Private DI for tests; default lazily builds the 014 factory. */
  createFactory?: () => WindowHelperFactory;
  /** Private DI for tests; default is the real current process pid. */
  currentPid?: number;
  /** Explicitly admits one trusted Papers-owned top-level window (the main
   * Papers shell) while every picker/widget/preview surface stays excluded. */
  allowCurrentProcessWindow?: (observation: WindowObservation) => boolean;
  /** Private DI for tests; default is app.getFileIcon. */
  getFileIcon?: (path: string) => Promise<Electron.NativeImage>;
  /** Private DI for tests; default is the bounded cadence constant. */
  observeCadenceMs?: number;
  /** Private DI for tests; default is Date.now. */
  now?: () => number;
  /** 028 P3: bounded durable validated-frame retention. Default is a
   * Papers-owned cache under the app userData dir; tests inject a store. */
  durableFrames?: ThumbnailFrameStore;
}

const HELPER_UNAVAILABLE: WindowCandidateListResult = {
  outcome: 'helper-unavailable',
  error: 'window helper is unavailable',
};

function boundedTitle(title: string): string {
  let truncated = title;
  while (Buffer.byteLength(truncated, 'utf8') > WINDOW_CAPABILITY_MAX_TITLE_BYTES) truncated = truncated.slice(0, -1);
  return truncated;
}

function fingerprint(path: string): string {
  return createHash('sha256').update(path.trim().toLowerCase(), 'utf8').digest('hex');
}

function appLabel(path: string): string {
  const leaf = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'Application';
  return boundedTitle(leaf.replace(/\.[^.]+$/, '') || 'Application');
}

/** 028 P3: default durable frame store under the app userData directory.
 * Lazily resolved so unit tests never require Electron; when the path cannot
 * be resolved a bounded NO-OP store is returned (durability degrades to the
 * in-memory last frame only). */
let defaultDurableFramesStore: ThumbnailFrameStore | null = null;
function defaultDurableFrames(): ThumbnailFrameStore {
  if (defaultDurableFramesStore) return defaultDurableFramesStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getPath(name: string): string } };
    const userData = electron?.app?.getPath?.('userData');
    if (typeof userData === 'string' && userData.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodePath = require('node:path') as typeof import('node:path');
      const dir = nodePath.join(userData, 'ayg-window-frames');
      defaultDurableFramesStore = createThumbnailFrameStore({ dir });
      return defaultDurableFramesStore;
    }
  } catch {
    /* fall through to the no-op store */
  }
  const noop: ThumbnailFrameStore = {
    put: () => undefined,
    get: () => null,
    delete: () => undefined,
    clear: () => undefined,
  };
  defaultDurableFramesStore = noop;
  return defaultDurableFramesStore;
}

/** Returns the trusted process id of a candidate, or null when the window
 * must be excluded: an unapproved Papers-owned surface, missing/empty title,
 * missing process path, or a non-positive process id. */
function trustedProcessId(
  observation: WindowObservation,
  currentPid: number,
  allowCurrentProcessWindow: (observation: WindowObservation) => boolean,
): number | null {
  if (observation.processId === null || observation.processId <= 0) return null;
  if (observation.processId === currentPid && !allowCurrentProcessWindow(observation)) return null;
  if (typeof observation.title !== 'string' || observation.title.length === 0) return null;
  if (typeof observation.processPath !== 'string' || observation.processPath.length === 0) return null;
  if (Buffer.byteLength(observation.processPath, 'utf8') > 4096) return null;
  return observation.processId;
}

export function createWindowCapabilityService(options: WindowCapabilityServiceOptions = {}): WindowCapabilityService {
  const stamp = options.now ?? (() => Date.now());
  let factory: WindowHelperFactory;
  let factoryBuilt = false;
  let stopped = false;
  let candidateIdCounter = 0;
  const candidatesByListedId = new Map<string, { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate }>();
  const bindings = new Map<string, { helperToken: RuntimeWindowId; touched: number }>();
  const bindingDescriptors = new Map<string, PersistedWindowMemberDescriptor>();
  const observations = new Map<string, Promise<WindowCapabilityResult>>();
  const iconCache = new Map<string, string>();
  /** 019G thumbnail duplicate-request shield: bounded TTL/LRU, cleared on
   * stop and wholesale on any factory/helper revision change (019GR3), so no
   * entry from a previous helper session can ever be served. */
  const thumbnailCache = new Map<string, { value: WindowCapabilityResult; touched: number }>();
  /** 021 P3 minimized-preview retention: the LAST strictly validated success
   * per binding, kept beyond the duplicate-request TTL so a window that is
   * still minimized can serve a USEFUL preview (the frame from the last time
   * the window was visibly captured). Served before the honest `minimized`
   * fallback. */
  const lastFrameCache = new Map<string, { value: WindowCapabilityResult; touched: number }>();
  /** 028 P3: bounded durable validated-frame retention (stable descriptor key),
   * so a member that HAS supplied real content keeps serving it while minimized
   * even when DWM/PrintWindow fail and the in-memory cache is empty. */
  const durableFrames = options.durableFrames ?? defaultDurableFrames();
  /** 028 P3 capture-before-minimize registration: bounded seeding state. */
  const frameSeedAt = new Map<string, number>();
  const frameSeedInFlight = new Set<string>();
  /** The factory session revision the current thumbnail cache was built
   * against; any change invalidates the ENTIRE cache before lookup. */
  let thumbnailCacheRevision = -1;
  let peekGeneration = 0;
  let peekRestoreTokens: RuntimeWindowId[] = [];
  let peekMinimizedTarget: RuntimeWindowId | null = null;
  let livePreview: { target: RuntimeWindowId; caller: string } | null = null;

  function purgeBindingThumbnails(bindingId: string): void {
    for (const key of [...thumbnailCache.keys()]) {
      if (key.startsWith(`${bindingId}|`)) thumbnailCache.delete(key);
    }
    lastFrameCache.delete(bindingId);
    const descriptor = bindingDescriptors.get(bindingId);
    if (descriptor) durableFrames.delete(thumbnailDescriptorKey(descriptor));
    bindingDescriptors.delete(bindingId);
    frameSeedAt.delete(bindingId);
    frameSeedInFlight.delete(bindingId);
  }

  function descriptorForBinding(bindingId: string): PersistedWindowMemberDescriptor | null {
    return bindingDescriptors.get(bindingId) ?? null;
  }

  /** 028 P3: a valid durable real-content frame for a binding, served as a
   * minimized real-content preview (source='dwm'). Returns null when nothing
   * durable is available. */
  function durableFrameResult(bindingId: string): WindowCapabilityResult | null {
    const descriptor = descriptorForBinding(bindingId);
    if (!descriptor) return null;
    const png = durableFrames.get(thumbnailDescriptorKey(descriptor));
    if (!png) return null;
    const dimensions = pngDimensions(png);
    if (!dimensions) return null;
    return {
      outcome: 'success',
      thumbnail: {
        image: png.toString('base64'),
        width: dimensions.width,
        height: dimensions.height,
        source: 'dwm',
        minimized: true,
      },
    };
  }

  /** 028 P3 capture-before-minimize registration: when a member is observed in
   * a normal (non-minimized) state and has no fresh retained real frame, issue
   * ONE bounded background thumbnail capture (rate-limited per binding,
   * single-flight) so a later minimize has real content without depending only
   * on the optional volatile cache. Never awaited by the observer. */
  function seedFrameIfNeeded(capability: WindowRuntimeCapability, bindingId: string): void {
    const descriptor = descriptorForBinding(bindingId);
    if (!descriptor) return;
    const key = thumbnailDescriptorKey(descriptor);
    const now = stamp();
    if (now - (frameSeedAt.get(bindingId) ?? -Infinity) < FRAME_SEED_MIN_INTERVAL_MS) return;
    if (frameSeedInFlight.has(bindingId)) return;
    if (lastFrameCache.has(bindingId) || durableFrames.get(key)) return;
    frameSeedAt.set(bindingId, now);
    frameSeedInFlight.add(bindingId);
    void thumbnailCapability(capability, { maxWidth: WINDOW_CAPABILITY_THUMBNAIL_DEFAULT_WIDTH, maxHeight: WINDOW_CAPABILITY_THUMBNAIL_DEFAULT_HEIGHT })
      .catch(() => undefined)
      .finally(() => frameSeedInFlight.delete(bindingId));
  }

  function retainLastFrame(bindingId: string, value: WindowCapabilityResult): void {
    lastFrameCache.set(bindingId, { value, touched: stamp() });
    if (lastFrameCache.size > WINDOW_CAPABILITY_THUMBNAIL_MAX_CACHE) {
      const oldest = [...lastFrameCache.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) lastFrameCache.delete(oldest[0]);
    }
  }

  /** 021 P3: a live capture reported `minimized`; serve the binding's last
   * retained validated frame (touched LRU) when one exists, else the honest
   * minimized fallback. Returns null when nothing is retained. */
  function lastFrameFor(bindingId: string): WindowCapabilityResult | null {
    const last = lastFrameCache.get(bindingId);
    if (!last) return null;
    last.touched = stamp();
    lastFrameCache.delete(bindingId);
    lastFrameCache.set(bindingId, last);
    return last.value;
  }

  const currentPid = options.currentPid ?? process.pid;
  const allowCurrentProcessWindow = options.allowCurrentProcessWindow ?? (() => false);
  // Lazy, guarded: only the Electron main process has `app`; unit tests
  // always inject getFileIcon and never reach this path.
  const getFileIcon = options.getFileIcon ?? ((filePath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getFileIcon(filePath: string): Promise<Electron.NativeImage> } };
    return electron?.app?.getFileIcon(filePath) ?? Promise.reject(new Error('electron app unavailable'));
  });

  function ensureFactory(): WindowHelperFactory {
    if (!factoryBuilt) {
      factory = options.createFactory
        ? options.createFactory()
        : createWindowHelperFactory({ timeoutMs: WINDOW_CAPABILITY_CLIENT_TIMEOUT_MS });
      factoryBuilt = true;
    }
    return factory;
  }

  async function ensureStarted(): Promise<boolean> {
    if (stopped) return false;
    const helper = ensureFactory();
    const outcome = await helper.start();
    return outcome === 'ready';
  }

  async function listCandidates(options: { includeNativeIcons?: boolean } = {}): Promise<WindowCandidateListResult> {
    if (stopped) return HELPER_UNAVAILABLE;
    if (!(await ensureStarted())) return HELPER_UNAVAILABLE;
    let result = await factory.list();
    if (result.outcome === 'timeout') {
      // The very first request can race the helper's startup/enumeration
      // latency; one bounded retry against the now-warm helper is made
      // before declaring it unavailable.
      result = await factory.list();
    }
    if (result.outcome !== 'success') {
      return { outcome: 'helper-unavailable', error: result.error };
    }
    const candidates: WindowCandidate[] = [];
    const listed = new Map<string, { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate }>();
    for (const observation of result.windows ?? []) {
      if (candidates.length >= WINDOW_CAPABILITY_MAX_CANDIDATES) break;
      const processId = trustedProcessId(observation, currentPid, allowCurrentProcessWindow);
      if (processId === null) continue;
      const entry = candidateForObservation(observation);
      // Interactive pick lists request exact native window/class icons so
      // packaged Electron apps do not collapse to generic executable tiles.
      // Internal relisting keeps the original cheap file-icon path.
      const icon = options.includeNativeIcons
        ? await nativeIconFor(observation)
        : await iconFor(observation);
      entry.candidate.icon = icon;
      if (!observation.bounds) continue;
      candidates.push(entry.candidate);
      listed.set(entry.candidate.id, entry);
    }
    candidatesByListedId.clear();
    for (const [id, entry] of listed) candidatesByListedId.set(id, entry);
    return { outcome: 'success', candidates };
  }

  async function iconFor(observation: WindowObservation): Promise<string | null> {
    const processPath = observation.processPath;
    if (typeof processPath !== 'string' || processPath.length === 0) return null;
    const cacheKey = `${observation.processId}|${processPath}`;
    const cached = iconCache.get(cacheKey);
    if (cached !== undefined) return cached;
    if (iconCache.size >= WINDOW_CAPABILITY_MAX_ICON_CACHE) return null;
    try {
      const image = await getFileIcon(processPath);
      const dataUrl = image.toDataURL();
      if (Buffer.byteLength(dataUrl, 'utf8') > 256 * 1024) return null;
      iconCache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      return null;
    }
  }

  /** Resolve the exact window/class icon for a trusted observation. The
   * helper's bounded 48x48 request is strictly correlated to this runtime
   * identity and falls back to the executable icon. */
  async function nativeIconFor(observation: WindowObservation): Promise<string | null> {
    try {
      const result = await factory.thumbnail(observation.runtimeId, 48, 48);
      if (result.outcome === 'success' && result.thumbnail?.source === 'icon') {
        return `data:image/png;base64,${result.thumbnail.image}`;
      }
    } catch {
      // Executable icon fallback below remains useful for conventional apps.
    }
    return iconFor(observation);
  }

  function listedEntry(candidateId: string): { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate } | null {
    return candidatesByListedId.get(candidateId) ?? null;
  }

  /** Builds the host-issued candidate + persisted descriptor + listed entry
   * for one trusted observation. The candidate id is STABLE per window
   * identity: it derives from the helper-session token, which the helper
   * reuses for an unchanged identity, so hover and list agree on the same id
   * and a click can be authorized against the exact highlighted candidate. */
  function candidateForObservation(observation: WindowObservation): { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate } {
    const helperToken = observation.runtimeId;
    const id = `wl-candidate-${helperToken}`;
    const descriptor: PersistedWindowMemberDescriptor = {
      version: 1,
      executableFingerprint: fingerprint(observation.processPath ?? ''),
      title: boundedTitle(observation.title),
    };
    const candidate: WindowCandidate = {
      id,
      title: boundedTitle(observation.title),
      applicationLabel: appLabel(observation.processPath ?? ''),
      icon: null,
      state: observation.state,
    };
    return { helperToken, descriptor, candidate };
  }

  /** 016 direct pick: resolve the topmost task-worthy candidate at a point.
   * The candidate (id stable per identity) is registered for binding but the
   * listed map is NOT cleared, so an open list picker is never invalidated by
   * hover polling. */
  async function hoverAt(x: number, y: number): Promise<WindowHoverResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    if (!Number.isFinite(x) || !Number.isFinite(y)
      || Math.abs(x) > WINDOW_CAPABILITY_PICK_POINT_RANGE || Math.abs(y) > WINDOW_CAPABILITY_PICK_POINT_RANGE) {
      return { outcome: 'missing', error: 'hover point is out of range' };
    }
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const result = await factory.hover(x, y);
    if (result.outcome !== 'success') {
      return { outcome: result.outcome === 'timeout' ? 'timeout' : 'helper-unavailable', error: result.error };
    }
    if (result.window === null || result.window === undefined) {
      return { outcome: 'success', candidate: null, bounds: null, descriptor: null };
    }
    // Same-process utility surfaces remain unpickable. The caller may
    // explicitly admit only the real main Papers shell.
    if (trustedProcessId(result.window, currentPid, allowCurrentProcessWindow) === null) {
      return { outcome: 'success', candidate: null, bounds: null, descriptor: null };
    }
    const entry = candidateForObservation(result.window);
    const icon = await iconFor(result.window);
    entry.candidate.icon = icon;
    if (!result.window.bounds) return { outcome: 'success', candidate: null, bounds: null, descriptor: entry.descriptor };
    candidatesByListedId.set(entry.candidate.id, entry);
    return { outcome: 'success', candidate: entry.candidate, bounds: result.window.bounds, descriptor: entry.descriptor };
  }

  /** 016 direct pick: re-resolve at the point and bind ONLY the exact
   * highlighted candidate; a change or vanishing is fail-closed. */
  async function pickAt(x: number, y: number, candidateId: string): Promise<WindowBindResult & { candidate?: WindowCandidate }> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const hovered = await hoverAt(x, y);
    if (hovered.outcome !== 'success' || !hovered.candidate) {
      return { outcome: 'missing', error: 'the hovered window is no longer eligible' };
    }
    if (hovered.candidate.id !== candidateId) {
      return { outcome: 'missing', error: 'the hovered window changed before the click' };
    }
    const bound = await bindCandidate(candidateId);
    if (bound.outcome !== 'success') return bound;
    return { ...bound, candidate: hovered.candidate };
  }

  function issueBinding(token: RuntimeWindowId): WindowRuntimeCapability {
    const bindingId = `wl-binding-${candidateIdCounter}-${Math.random().toString(36).slice(2, 12)}`;
    if (bindings.size >= 128) {
      const oldest = [...bindings.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) bindings.delete(oldest[0]);
    }
    bindings.set(bindingId, { helperToken: token, touched: Date.now() });
    return { version: 1, bindingId };
  }

  function tokenFor(capability: WindowRuntimeCapability): RuntimeWindowId | null {
    const entry = capability.bindingId ? bindings.get(capability.bindingId) : undefined;
    if (!entry) return null;
    entry.touched = Date.now();
    return entry.helperToken;
  }

  async function bindCandidate(candidateId: string): Promise<WindowBindResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const entry = listedEntry(candidateId);
    if (!entry) {
      return { outcome: 'missing', error: 'candidate is not currently listed' };
    }
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const observed = await factory.observe(entry.helperToken);
    if (observed.outcome !== 'success') {
      if (observed.outcome === 'missing') return { outcome: 'missing', error: observed.error };
      return { outcome: observed.outcome === 'timeout' ? 'timeout' : 'helper-unavailable', error: observed.error };
    }
    const capability = issueBinding(entry.helperToken);
    const bindingId = capability.bindingId;
    if (!bindingId) return { outcome: 'helper-unavailable', error: 'binding failed' };
    const descriptor = entry.descriptor;
    bindingDescriptors.set(bindingId, descriptor);
    return { outcome: 'success', capability, descriptor };
  }

  async function observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const bindingId = capability.bindingId ?? '';
    const previous = observations.get(bindingId);
    if (previous) return previous;
    const request = factory.observe(token).then((result) => {
      // 028 P3 capture-before-minimize: while the member is observed NORMAL and
      // has no fresh retained real frame, seed one bounded background capture so
      // a later minimize serves real content without depending only on the
      // volatile cache.
      if (result.outcome === 'success' && result.observation && result.observation.state !== 'minimized') {
        seedFrameIfNeeded(capability, bindingId);
      }
      return result;
    }).finally(() => observations.delete(bindingId));
    observations.set(bindingId, request);
    return request;
  }

  async function minimizeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    return factory.minimize(token);
  }

  async function restoreCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    return factory.restore(token);
  }

  async function closeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    return factory.close(token);
  }

  async function endPeek(): Promise<WindowCapabilityResult> {
    peekGeneration += 1;
    const restore = peekRestoreTokens.splice(0);
    const reminimize = peekMinimizedTarget;
    peekMinimizedTarget = null;
    if (!factoryBuilt || stopped) return { outcome: 'success' };
    if (restore.length > 0 && factory.uncloakMany) {
      await factory.uncloakMany(restore.reverse()).catch(() => undefined);
    } else {
      await Promise.all(restore.reverse().map((token) =>
        factory.uncloak?.(token).catch(() => undefined)));
    }
    if (reminimize) await factory.minimize(reminimize).catch(() => undefined);
    return { outcome: 'success' };
  }

  async function beginPeekCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const target = tokenFor(capability);
    if (!target) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };

    const generation = ++peekGeneration;

    if (peekMinimizedTarget && peekMinimizedTarget !== target) {
      await factory.minimize(peekMinimizedTarget).catch(() => undefined);
      peekMinimizedTarget = null;
    }

    const listed = await factory.list();
    if (listed.outcome !== 'success') return { outcome: listed.outcome, error: listed.error };
    const targetObservation = (listed.windows ?? []).find((observation) => observation.runtimeId === target);

    // Differential Peek transition: when the pointer moves A -> B, every
    // window hidden for A except B should remain hidden. Reveal B first, then
    // hide only newly-visible windows (normally just A). The old full
    // restore/re-hide cycle made a row of icons visibly cascade and flash.
    const previous = peekRestoreTokens.splice(0);
    const retained = previous.filter((token) => token !== target);
    peekRestoreTokens.push(...retained);
    if (previous.includes(target)) {
      const revealed = await factory.uncloak?.(target).catch(() => undefined);
      if (!revealed || revealed.outcome !== 'success') {
        peekRestoreTokens.push(target);
        return revealed ?? { outcome: 'helper-unavailable', error: 'window reveal is unavailable' };
      }
    }
    if (targetObservation?.state === 'minimized') {
      const revealed = await factory.uncloak?.(target).catch(() => undefined);
      if (!revealed || revealed.outcome !== 'success') {
        return revealed ?? { outcome: 'helper-unavailable', error: 'minimized window reveal is unavailable' };
      }
      peekMinimizedTarget = target;
    }
    if (generation !== peekGeneration) return { outcome: 'success' };
    if (!factory.cloak) return { outcome: 'helper-unavailable', error: 'window cloak is unavailable' };
    const toHide = (listed.windows ?? []).filter((observation) =>
      observation.runtimeId !== target
      && observation.state !== 'minimized'
      && trustedProcessId(observation, currentPid, allowCurrentProcessWindow) !== null
      && !peekRestoreTokens.includes(observation.runtimeId));
    const tokens = toHide.map((observation) => observation.runtimeId);
    if (tokens.length > 0 && factory.cloakMany) {
      const result = await factory.cloakMany(tokens);
      if (result.outcome === 'success') {
        if (generation === peekGeneration) peekRestoreTokens.push(...tokens);
        else if (factory.uncloakMany) await factory.uncloakMany(tokens).catch(() => undefined);
      }
    } else {
      await Promise.all(toHide.map(async (observation) => {
        const result = await factory.cloak!(observation.runtimeId);
        if (result.outcome !== 'success') return;
        if (generation === peekGeneration) peekRestoreTokens.push(observation.runtimeId);
        else await factory.uncloak?.(observation.runtimeId).catch(() => undefined);
      }));
    }
    return { outcome: 'success' };
  }

  async function endLivePreview(): Promise<WindowCapabilityResult> {
    const activePreview = livePreview;
    livePreview = null;
    if (!activePreview || !factory.livePreview || stopped) return { outcome: 'success' };
    return factory.livePreview(activePreview.target, activePreview.caller, false);
  }

  async function beginLivePreviewCapability(capability: WindowRuntimeCapability, caller: string): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const target = tokenFor(capability);
    if (!target) return { outcome: 'missing', error: 'binding is not issued' };
    if (!/^[1-9][0-9]{0,19}$/.test(caller)) return { outcome: 'malformed', error: 'caller window is malformed' };
    if (!(await ensureStarted()) || !factory.livePreview) return { outcome: 'helper-unavailable', error: 'DWM live preview is unavailable' };
    if (livePreview && (livePreview.target !== target || livePreview.caller !== caller)) await endLivePreview().catch(() => undefined);
    const result = await factory.livePreview(target, caller, true);
    if (result.outcome === 'success') livePreview = { target, caller };
    return result;
  }

  async function applyCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    return factory.apply(token, bounds);
  }

  /** Strictly validates one thumbnail dimension: absent -> the contract
   * default, present but not a positive safe integer within the max -> typed
   * malformed (fail closed, never clamped to a guessed value). */
  function normalizeThumbnailDimension(
    value: number | undefined,
    fallback: number,
    max: number,
    name: string,
  ): { kind: 'ok'; value: number } | { kind: 'malformed'; result: WindowCapabilityResult } {
    if (value === undefined) return { kind: 'ok', value: fallback };
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > max) {
      return { kind: 'malformed', result: { outcome: 'malformed', error: `${name} must be a positive integer at most ${max}` } };
    }
    return { kind: 'ok', value };
  }

  /** 019G real-window thumbnail. The main-process cache is ONLY a
   * duplicate-request shield (TTL <= 750 ms, LRU <= 8 entries): it stores
   * strictly validated successes, is keyed by (bindingId, dimensions), never
   * by HWND/token, and touches/reinserts on every hit so eviction is TRUE LRU
   * rather than FIFO. ANY factory/helper revision change clears the ENTIRE
   * cache before lookup (019GR3); a lost binding still purges that binding's
   * entries and the token is re-resolved from the live binding before the
   * cache is consulted. */
  async function thumbnailCapability(
    capability: WindowRuntimeCapability,
    options: { maxWidth?: number; maxHeight?: number } = {},
  ): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const bindingId = capability.bindingId ?? '';
    const token = tokenFor(capability);
    if (!token) {
      // The binding is gone: drop its cached thumbnails AND retained last frame
      // BEFORE failing closed, so a stale image can never be served after a
      // capability invalidation.
      purgeBindingThumbnails(bindingId);
      return { outcome: 'missing', error: 'binding is not issued' };
    }
    const maxWidth = normalizeThumbnailDimension(
      options.maxWidth, WINDOW_CAPABILITY_THUMBNAIL_DEFAULT_WIDTH, WINDOW_THUMBNAIL_MAX_WIDTH, 'maxWidth');
    if (maxWidth.kind === 'malformed') return maxWidth.result;
    const maxHeight = normalizeThumbnailDimension(
      options.maxHeight, WINDOW_CAPABILITY_THUMBNAIL_DEFAULT_HEIGHT, WINDOW_THUMBNAIL_MAX_HEIGHT, 'maxHeight');
    if (maxHeight.kind === 'malformed') return maxHeight.result;
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };

    const key = `${bindingId}|${maxWidth.value}x${maxHeight.value}`;
    const revision = factory.revision;
    if (thumbnailCacheRevision !== revision) {
      // 019GR3/021: a helper replacement invalidates the WHOLE cache (the
      // duplicate-request shield AND every retained last frame) so no entry
      // from a previous session can ever be served.
      thumbnailCache.clear();
      lastFrameCache.clear();
      thumbnailCacheRevision = revision;
    }
    const cached = thumbnailCache.get(key);
    if (cached) {
      if (stamp() - cached.touched > WINDOW_CAPABILITY_THUMBNAIL_TTL_MS) {
        thumbnailCache.delete(key);
      } else {
        // Touch and reinsert on hit so eviction order is TRUE LRU.
        cached.touched = stamp();
        thumbnailCache.delete(key);
        thumbnailCache.set(key, cached);
        return cached.value;
      }
    }

    const result = await factory.thumbnail(token, maxWidth.value, maxHeight.value);
    if (result.outcome === 'success' && result.thumbnail && isValidThumbnail(result.thumbnail)) {
      // 025/028: a minimized TERMINAL icon preview must never supersede a
      // retained real-content frame. Serve the DURABLE validated frame, then
      // the in-memory last frame, before ever returning the terminal icon.
      const isTerminalIcon = result.thumbnail.minimized === true && result.thumbnail.source === 'icon';
      if (isTerminalIcon) {
        const durable = durableFrameResult(bindingId);
        if (durable) return durable;
        const lastFrame = lastFrameFor(bindingId);
        if (lastFrame) return lastFrame;
      }
      thumbnailCache.set(key, { value: result, touched: stamp() });
      if (thumbnailCache.size > WINDOW_CAPABILITY_THUMBNAIL_MAX_CACHE) {
        const oldest = [...thumbnailCache.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
        if (oldest) thumbnailCache.delete(oldest[0]);
      }
      // 021/028: retain the last validated REAL frame per binding (in-memory
      // AND durably by stable descriptor key) so a later minimized window can
      // serve a useful preview even when the live capture fails. Icons excluded.
      if (!isTerminalIcon) {
        retainLastFrame(bindingId, result);
        const descriptor = descriptorForBinding(bindingId);
        if (descriptor) {
          try {
            durableFrames.put(thumbnailDescriptorKey(descriptor), Buffer.from(result.thumbnail.image, 'base64'));
          } catch {
            /* a failed durable write never fails the request */
          }
        }
      }
      return result;
    }
    if (result.outcome === 'minimized') {
      // 021/028: a live capture reports the window is minimized - serve the
      // binding's DURABLE validated frame, then the in-memory last frame, as
      // the useful minimized preview; only with neither is the honest
      // minimized fallback returned.
      const durable = durableFrameResult(bindingId);
      if (durable) return durable;
      const lastFrame = lastFrameFor(bindingId);
      if (lastFrame) return lastFrame;
    }
    return result;
  }

  async function resolvePersisted(descriptor: PersistedWindowMemberDescriptor): Promise<WindowResolveResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const listed = await listCandidates();
    if (listed.outcome !== 'success') return { outcome: 'helper-unavailable', error: listed.error };
    const matches = [...candidatesByListedId.entries()].filter(([, entry]) =>
      entry.descriptor.executableFingerprint === descriptor.executableFingerprint
      && entry.descriptor.title === descriptor.title);
    if (matches.length === 0) return { outcome: 'missing', error: 'no visible window matches the descriptor' };
    if (matches.length > 1) return { outcome: 'ambiguous', error: 'more than one visible window matches the descriptor' };
    const bound = await bindCandidate(matches[0]![0]);
    if (bound.outcome !== 'success') {
      return { outcome: bound.outcome, error: bound.error };
    }
    return { outcome: 'success', capability: bound.capability, descriptor: bound.descriptor };
  }

  async function nativePickerSnapshot(): Promise<
    | { outcome: 'success'; observations: WindowObservation[] }
    | { outcome: 'helper-unavailable' | 'timeout'; error?: string }
  > {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    let result = await factory.list();
    if (result.outcome === 'timeout') result = await factory.list();
    if (result.outcome !== 'success') {
      return {
        outcome: result.outcome === 'timeout' ? 'timeout' : 'helper-unavailable',
        error: result.error,
      };
    }
    return {
      outcome: 'success',
      observations: (result.windows ?? []).filter((observation) =>
        trustedProcessId(observation, currentPid, allowCurrentProcessWindow) !== null && observation.bounds !== null),
    };
  }

  function nativeIdentity(observation: WindowObservation): NativePickerWindowIdentity | null {
    const processId = trustedProcessId(observation, currentPid, allowCurrentProcessWindow);
    if (processId === null || !observation.bounds) return null;
    return { processId, ...observation.bounds };
  }

  function sameNativeIdentity(observation: WindowObservation, identity: NativePickerWindowIdentity): boolean {
    const current = nativeIdentity(observation);
    return current !== null
      && current.processId === identity.processId
      && current.x === identity.x
      && current.y === identity.y
      && current.width === identity.width
      && current.height === identity.height;
  }

  async function prepareNativePicker(memberDescriptors: PersistedWindowMemberDescriptor[]): Promise<NativePickerSeedResult> {
    if (memberDescriptors.length > WINDOW_CAPABILITY_MAX_CANDIDATES) {
      return { outcome: 'ambiguous', error: 'picker member count exceeds the bounded native selection limit' };
    }
    const snapshot = await nativePickerSnapshot();
    if (snapshot.outcome !== 'success') return snapshot;
    const seeds: NativePickerWindowIdentity[] = [];
    const claimed = new Set<string>();
    for (const descriptor of memberDescriptors) {
      const matches = snapshot.observations.filter((observation) => {
        const candidate = candidateForObservation(observation);
        return candidate.descriptor.executableFingerprint === descriptor.executableFingerprint
          && candidate.descriptor.title === descriptor.title;
      });
      // A persisted layout may legitimately contain a closed window. It cannot
      // be painted green, but it must not prevent the creator from opening the
      // picker to add/remove the windows that are currently on screen.
      if (matches.length === 0) continue;
      if (matches.length > 1) return { outcome: 'ambiguous', error: `layout member is ambiguous: ${descriptor.title}` };
      const identity = nativeIdentity(matches[0]!);
      if (!identity) continue;
      const key = `${identity.processId}|${identity.x}|${identity.y}|${identity.width}|${identity.height}`;
      if (claimed.has(key)) return { outcome: 'ambiguous', error: `layout members resolve to the same native window: ${descriptor.title}` };
      claimed.add(key);
      seeds.push(identity);
    }
    return { outcome: 'success', seeds };
  }

  async function bindNativePickerSelection(selections: NativePickerWindowIdentity[]): Promise<NativePickerBindResult> {
    if (selections.length > WINDOW_CAPABILITY_MAX_CANDIDATES) {
      return { outcome: 'ambiguous', error: 'picker selection exceeds the bounded native selection limit' };
    }
    const snapshot = await nativePickerSnapshot();
    if (snapshot.outcome !== 'success') return snapshot;
    const matched: WindowObservation[] = [];
    const claimedTokens = new Set<RuntimeWindowId>();
    for (const selection of selections) {
      const matches = snapshot.observations.filter((observation) => sameNativeIdentity(observation, selection));
      if (matches.length === 0) return { outcome: 'missing', error: 'a selected window changed before commit' };
      if (matches.length > 1) return { outcome: 'ambiguous', error: 'a selected native identity matches more than one window' };
      if (claimedTokens.has(matches[0]!.runtimeId)) return { outcome: 'ambiguous', error: 'the final picker set contains a duplicate window' };
      claimedTokens.add(matches[0]!.runtimeId);
      matched.push(matches[0]!);
    }

    // The helper is a single ordered native session. Bind the final snapshot
    // in that same order instead of fanning several observe requests into it
    // concurrently; a slow icon lookup or native observation must not make an
    // otherwise valid Enter commit disappear behind a rejected pending call.
    const boundWindows: Array<{
      entry: ReturnType<typeof candidateForObservation>;
      bound: WindowBindResult;
    }> = [];
    for (const observation of matched) {
      const entry = candidateForObservation(observation);
      entry.candidate.icon = await nativeIconFor(observation);
      candidatesByListedId.set(entry.candidate.id, entry);
      const bound = await bindCandidate(entry.candidate.id);
      boundWindows.push({ entry, bound });
      if (bound.outcome !== 'success') break;
    }
    const failed = boundWindows.find(({ bound }) => bound.outcome !== 'success');
    if (failed && failed.bound.outcome !== 'success') return { outcome: failed.bound.outcome, error: failed.bound.error };
    const windows = boundWindows.map(({ entry, bound }) => {
      if (bound.outcome !== 'success') throw new Error('unreachable failed native picker binding');
      return { descriptor: bound.descriptor, capability: bound.capability, candidate: entry.candidate };
    });
    return { outcome: 'success', windows };
  }

  async function stop(): Promise<void> {
    await endLivePreview().catch(() => undefined);
    await endPeek().catch(() => undefined);
    if (stopped) return;
    stopped = true;
    candidatesByListedId.clear();
    bindings.clear();
    bindingDescriptors.clear();
    observations.clear();
    thumbnailCache.clear();
    lastFrameCache.clear();
    frameSeedAt.clear();
    frameSeedInFlight.clear();
    thumbnailCacheRevision = -1;
    if (factoryBuilt) {
      await factory.stop().catch(() => undefined);
    }
  }

  return {
    listCandidates,
    bindCandidate,
    observeCapability,
    minimizeCapability,
    restoreCapability,
    closeCapability,
    beginPeekCapability,
    endPeek,
    beginLivePreviewCapability,
    endLivePreview,
    applyCapability,
    thumbnailCapability,
    resolvePersisted,
    hoverAt,
    pickAt,
    prepareNativePicker,
    bindNativePickerSelection,
    stop,
  };
}
