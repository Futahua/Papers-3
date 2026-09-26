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
import { defaultWindowGeometryJournal, monitorWorkAreas, type WindowGeometryJournal } from './windowGeometryJournal';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
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
/** Native (helper-resolved) icons are the expensive ones — identity revalidation,
 * up to three WM_GETICON probes, GDI capture, PNG and base64 — so they are kept
 * per stable window identity for the whole helper session, not per list. */
export const WINDOW_CAPABILITY_MAX_NATIVE_ICON_CACHE = 128;
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
  /** Exact host-observed identity for associating this live row with an
   * Auto member. It is not authority to invoke a window operation. */
  windowInstanceId?: string;
}

/** Stable, persisted-safe member identity for fail-closed re-resolution of
 * an ALREADY VISIBLE window. Deliberately contains no runtime id, token,
 * HWND or executable authority. */
export interface PersistedWindowMemberDescriptor {
  version: 1;
  executableFingerprint?: string;
  title: string;
  windowInstanceId?: string;
}

/** Compares persisted descriptor identity without treating title as an exact
 * identity once either side carries a host-issued window instance ID. */
export function compareWindowMemberIdentity(
  left: PersistedWindowMemberDescriptor,
  right: PersistedWindowMemberDescriptor,
): 'same' | 'different' | 'ambiguous' {
  const leftId = left.windowInstanceId;
  const rightId = right.windowInstanceId;
  const leftHasId = typeof leftId === 'string' && /^W[0-9a-f]{16}$/i.test(leftId);
  const rightHasId = typeof rightId === 'string' && /^W[0-9a-f]{16}$/i.test(rightId);
  if ((leftId !== undefined && !leftHasId) || (rightId !== undefined && !rightHasId)) return 'ambiguous';
  if (leftHasId && rightHasId) return leftId!.toLowerCase() === rightId!.toLowerCase() ? 'same' : 'different';

  const leftFingerprint = left.executableFingerprint;
  const rightFingerprint = right.executableFingerprint;
  const leftHasFingerprint = typeof leftFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(leftFingerprint);
  const rightHasFingerprint = typeof rightFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(rightFingerprint);
  if (!leftHasFingerprint || !rightHasFingerprint) return 'ambiguous';
  if (leftFingerprint!.toLowerCase() !== rightFingerprint!.toLowerCase()) return 'different';

  // Same executable plus exactly one WID can be the same window after a
  // retitle or a sibling. Only an exact WID match proves identity.
  if (leftHasId !== rightHasId) return 'ambiguous';
  return left.title === right.title ? 'same' : 'different';
}

/** A legacy row may be associated with one modern WID row only when its
 * complete legacy key agrees; callers must still require that association to
 * be unique in the surrounding set. */
export function canFallbackLegacyWindowIdentity(
  left: PersistedWindowMemberDescriptor,
  right: PersistedWindowMemberDescriptor,
): boolean {
  const leftHasId = typeof left.windowInstanceId === 'string' && /^W[0-9a-f]{16}$/i.test(left.windowInstanceId);
  const rightHasId = typeof right.windowInstanceId === 'string' && /^W[0-9a-f]{16}$/i.test(right.windowInstanceId);
  if ((left.windowInstanceId !== undefined && !leftHasId)
    || (right.windowInstanceId !== undefined && !rightHasId)) return false;
  const leftFingerprint = left.executableFingerprint;
  const rightFingerprint = right.executableFingerprint;
  return leftHasId !== rightHasId
    && typeof leftFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(leftFingerprint)
    && typeof rightFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(rightFingerprint)
    && leftFingerprint.toLowerCase() === rightFingerprint.toLowerCase()
    && left.title === right.title;
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

export interface WindowInstanceSnapshot {
  complete: boolean;
  trackerSessionId: string;
  sequence: number;
  windows: Array<{ windowInstanceId: string }>;
  error?: string;
}

export interface WindowLifecycleEvent {
  kind: 'open' | 'gone';
  windowInstanceId: string;
  trackerSessionId: string;
  sequence: number;
  observation?: { bounds: WindowBounds; state: WindowState };
}

/** Machine-local identity used only at the SlopTop picker boundary. It is
 * deliberately non-persistable: AHK uses the PID + current visible rectangle
 * to seed and return its local green set, then Papers immediately resolves it
 * back into ordinary capabilities/descriptors. */
export interface NativePickerWindowIdentity extends WindowBounds {
  processId: number;
}

export type NativePickerSeedResult =
  | {
    outcome: 'success';
    seeds: Array<NativePickerWindowIdentity & { seedId: number }>;
    /** Which of the requested members were actually presented to the picker, by
     * their index in the request. A member that could not be matched is NOT
     * seeded and therefore never shown as green - so its absence from the final
     * set is not a removal gesture, and the commit must not read it as one. */
    seededIndices: number[];
  }
  | { outcome: 'missing' | 'ambiguous' | 'helper-unavailable' | 'timeout'; error?: string };

export type NativePickerBindResult =
  | { outcome: 'success'; windows: Array<{ descriptor: PersistedWindowMemberDescriptor; capability: WindowRuntimeCapability; candidate: WindowCandidate }> }
  | { outcome: 'missing' | 'ambiguous' | 'helper-unavailable' | 'timeout'; error?: string };

export interface WindowCapabilityService {
  listCandidates(options?: { includeNativeIcons?: boolean }): Promise<WindowCandidateListResult>;
  windowLifecycleSnapshot(): Promise<{ snapshot: WindowInstanceSnapshot }>;
  resolveWindowInstance(windowInstanceId: string): Promise<WindowResolveResult>;
  watchWindowLifecycle(callbacks: {
    onEvent: (event: WindowLifecycleEvent) => void;
    onBaseline: (snapshot: WindowInstanceSnapshot) => void;
  }): () => void;
  /** Hold the periodic lifecycle enumeration off while a native candidate
   * chooser is on screen, so the chooser's hover work is not queued behind a
   * desktop enumeration on the same single-request helper. Ref-counted and
   * deliberately separate from the candidate-list in-flight guard. `drained`
   * settles once an enumeration already running at acquisition has finished;
   * the last `release` runs exactly one catch-up enumeration and resolves every
   * caller that was waiting on a deferred snapshot. */
  holdWindowLifecycleRefresh(): { release: () => void; drained: Promise<void> };
  bindCandidate(candidateId: string): Promise<WindowBindResult>;
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  minimizeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  restoreCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  /** One helper request that reads the live state and minimizes or restores
   * accordingly, returning the direction taken plus the PRE-mutation
   * observation. Deliberately does NOT seed a preview frame the way
   * observeCapability does: putting a capture on this path would reintroduce
   * exactly the latency this method exists to remove. */
  toggleCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  /** Explicit Ctrl+middle-click action. Closes only the exact verified window;
   * sibling windows owned by the same process remain untouched. */
  closeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  endProcessCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
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
  bindNativePickerSelection(
    selections: NativePickerWindowIdentity[],
    unchangedMembers?: PersistedWindowMemberDescriptor[],
  ): Promise<NativePickerBindResult>;
  stop(): Promise<void>;
}

export interface WindowCapabilityServiceOptions {
  /** Private DI for tests; default is the machine-local geometry journal. */
  geometryJournal?: WindowGeometryJournal;
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

/** Prefer the package's declared app-list art over a generic executable or
 * window-class glyph. The path comes from the trusted native observation. */
function packagedAppLogo(processPath: string): string | null {
  const marker = /^(.*?[\\/]WindowsApps[\\/][^\\/]+)[\\/]/i.exec(processPath);
  if (!marker) return null;
  const packageRoot = marker[1]!;
  try {
    const manifest = readFileSync(path.join(packageRoot, 'AppxManifest.xml'));
    if (manifest.length > 1024 * 1024) return null;
    const logo = /\bSquare44x44Logo\s*=\s*"([^"]+)"/i.exec(manifest.toString('utf8'))?.[1];
    if (!logo || !/\.png$/i.test(logo)) return null;
    const relative = logo.replace(/[\\/]/g, path.sep);
    const base = path.resolve(packageRoot, relative);
    const root = path.resolve(packageRoot) + path.sep;
    if (!base.toLowerCase().startsWith(root.toLowerCase())) return null;
    const stem = base.slice(0, -4);
    const candidates = [
      `${stem}.targetsize-48.png`,
      `${stem}_targetsize-48.png`,
      `${stem}.scale-100.png`,
      `${stem}.scale-200.png`,
      base,
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      const bytes = readFileSync(candidate);
      if (bytes.length > 0 && bytes.length <= 192 * 1024) {
        return `data:image/png;base64,${bytes.toString('base64')}`;
      }
    }
  } catch { /* unavailable package metadata falls through to native icons */ }
  return null;
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
  if (observation.windowClass === 'Progman' || observation.windowClass === 'WorkerW') return null;
  if (typeof observation.processPath === 'string' && /(?:^|[\\/])TextInputHost\.exe$/i.test(observation.processPath)) return null;
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
  const rememberCandidate = (entry: { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate }): void => {
    const id = entry.candidate.id;
    candidatesByListedId.delete(id);
    candidatesByListedId.set(id, entry);
    // Background lists must not erase a Direct Pick's staged exact identity.
    // The helper still re-observes the token before binding, and this bounded
    // LRU prevents old candidates from accumulating across a long session.
    while (candidatesByListedId.size > 256) {
      const oldest = candidatesByListedId.keys().next().value;
      if (oldest === undefined) break;
      candidatesByListedId.delete(oldest);
    }
  };
  const bindings = new Map<string, { helperToken: RuntimeWindowId; touched: number }>();
  const bindingObservations = new Map<string, WindowObservation>();
  const bindingDescriptors = new Map<string, PersistedWindowMemberDescriptor>();
  const observations = new Map<string, Promise<WindowCapabilityResult>>();
  const iconCache = new Map<string, string>();
  const iconReadsInFlight = new Map<string, Promise<string | null>>();
  let lifecycleCurrent = new Map<string, { token: RuntimeWindowId; observation: WindowObservation }>();
  let lifecycleRevision = -1;
  let lifecycleLastObservations: WindowObservation[] | null = null;
  let lifecycleLastObservedAt = Number.NEGATIVE_INFINITY;
  let lifecycleTrackerSessionId = randomUUID();
  let lifecycleSequence = 0;
  let lifecycleTimer: ReturnType<typeof setInterval> | null = null;
  let lifecycleRefresh: Promise<WindowInstanceSnapshot> | null = null;
  let lifecycleBaselinePending = false;
  let nativeCandidateListsInFlight = 0;
  /** Live candidate choosers. Kept separate from the in-flight list guard on
   * purpose: pretending an open picker is an enumeration would make one
   * counter mean two different things, and the chooser outlives its list. */
  let candidatePickerHolds = 0;
  /** Interactive captures in flight. The client deliberately holds a thumbnail
   * back while ANY control request is pending, and the periodic lifecycle
   * enumeration is one of those - so a preview requested during a watcher tick
   * waits for it and is usually discarded as stale by the time it runs, which
   * reads as "this preview never showed". While a capture is outstanding the
   * enumeration yields, and the last one to settle runs the usual single
   * catch-up. */
  let thumbnailsInFlight = 0;
  /** Diagnostic: an observation that could not be served at all. A pick's ADD is
   * dropped by the project when the capability it was handed cannot be observed,
   * and the creator sees only "nothing happened" - so the refusal is recorded. */
  function recordObserveFailure(capability: WindowRuntimeCapability, reason: string): void {
    try {
      geometryJournal.record({
        kind: 'observe-fail',
        detail: reason,
        title: capability.bindingId ?? '',
        outcome: 'failed',
      });
    } catch {
      /* diagnostics never fail the action they describe */
    }
  }

  /** Diagnostic: a real minimize/restore, with the window it touched. A burst of
   * these right after a restart is the layout-recording replay restoring members. */
  function recordStateChange(kind: 'minimize' | 'restore', capability: WindowRuntimeCapability, result: WindowCapabilityResult): void {
    try {
      geometryJournal.record({
        kind,
        title: descriptorForBinding(capability.bindingId ?? '')?.title ?? '',
        observed: result.observation?.bounds ?? null,
        outcome: result.outcome,
      });
    } catch {
      /* diagnostics never fail the action they describe */
    }
  }

  /** Durable record of the rectangles Papers applies, so a window that ends up
   * tiny in a corner can be traced to the request or to the clamp. */
  const geometryJournal = options.geometryJournal ?? defaultWindowGeometryJournal();
  let lifecycleCatchupRequired = false;
  let lifecycleRefreshDeferred: Promise<WindowInstanceSnapshot> | null = null;
  let resolveLifecycleRefreshDeferred: ((snapshot: WindowInstanceSnapshot) => void) | null = null;
  const lifecycleSubscribers = new Set<{
    onEvent: (event: WindowLifecycleEvent) => void;
    onBaseline: (snapshot: WindowInstanceSnapshot) => void;
  }>();
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
  /** Native icons by stable window identity, plus their in-flight reads so two
   * lists opened together cannot ask the single-request helper twice. */
  const nativeIconCache = new Map<string, string>();
  const nativeIconReadsInFlight = new Map<string, Promise<string | null>>();
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

  /** Lifecycle refresh is blocked while a native candidate enumeration is in
   * flight, a candidate chooser is alive, or an interactive capture is
   * outstanding. All three put work on the same single-request helper, and all
   * three are temporary. Priority, in order: real control, interactive capture,
   * periodic enumeration. */
  function lifecycleRefreshBlocked(): boolean {
    return nativeCandidateListsInFlight > 0 || candidatePickerHolds > 0 || thumbnailsInFlight > 0;
  }

  /** One deferred catch-up enumeration, run only once nothing blocks refresh.
   * Every caller that shared the deferred promise is resolved by that single
   * enumeration, so the helper sees one list instead of one per waiter. */
  function runLifecycleCatchupIfUnblocked(): void {
    if (lifecycleRefreshBlocked() || !lifecycleCatchupRequired) return;
    lifecycleCatchupRequired = false;
    const runCatchup = (): void => {
      const refresh = refreshWindowLifecycle(lifecycleBaselinePending);
      void refresh.then((snapshot) => resolveLifecycleRefreshDeferred?.(snapshot), () => {
        resolveLifecycleRefreshDeferred?.(lifecycleSnapshot(false, 'window enumeration failed'));
      }).finally(() => {
        lifecycleRefreshDeferred = null;
        resolveLifecycleRefreshDeferred = null;
      });
    };
    // Let the blocking request settle first, then take one fresh baseline/diff
    // so Auto observes any windows opened during the chooser without
    // interleaving helper RPCs among native icon reads.
    queueMicrotask(() => {
      if (lifecycleRefresh) void lifecycleRefresh.then(runCatchup, runCatchup);
      else runCatchup();
    });
  }

  /** Called once per live candidate chooser. Blocking starts immediately; the
   * returned `drained` settles when an enumeration that was ALREADY running at
   * acquisition has finished, because that one cannot be cancelled and would
   * otherwise sit in front of the chooser's first hover. `release` is
   * idempotent, and the final one triggers the catch-up. */
  function holdWindowLifecycleRefresh(): { release: () => void; drained: Promise<void> } {    candidatePickerHolds += 1;
    if (lifecycleSubscribers.size > 0) lifecycleCatchupRequired = true;
    // Capture the in-flight enumeration directly. Asking refreshWindowLifecycle()
    // here would return the deferred promise, which settles only on release.
    const inFlight = lifecycleRefresh;
    const drained = inFlight === null
      ? Promise.resolve()
      : inFlight.then(() => undefined, () => undefined);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      candidatePickerHolds = Math.max(0, candidatePickerHolds - 1);
      runLifecycleCatchupIfUnblocked();
    };
    return { release, drained };
  }

  /** One hold per peek session, however many preview requests it makes. A
   * session is a Shift sweep across icons or a chooser row hover, and it ends
   * through endLivePreview(), endPeek() or stop(). */
  let peekLifecycleRelease: (() => void) | null = null;
  function holdLifecycleForPeek(): void {
    if (peekLifecycleRelease !== null) return;
    peekLifecycleRelease = holdWindowLifecycleRefresh().release;
  }
  function releaseLifecycleForPeek(): void {
    const release = peekLifecycleRelease;
    peekLifecycleRelease = null;
    release?.();
  }

  async function listCandidates(options: { includeNativeIcons?: boolean } = {}): Promise<WindowCandidateListResult> {
    const nativeIcons = options.includeNativeIcons === true;
    const preferRecentLifecycle = options.includeNativeIcons === false;
    if (nativeIcons) {
      nativeCandidateListsInFlight += 1;
      if (lifecycleSubscribers.size > 0) lifecycleCatchupRequired = true;
    }
    try {
      if (stopped) return HELPER_UNAVAILABLE;
      if (!(await ensureStarted())) return HELPER_UNAVAILABLE;
      // The visible chooser can use the watcher's recent complete enumeration.
      // Bind/act still re-observe the clicked token, so a vanished window can
      // never be acted on from this presentation cache. Other callers retain
      // a fresh list, and the cache expires after two watcher intervals.
      //
      // The exception is contention: the helper serves one request at a time, so
      // a chooser request that arrives while the 500 ms watcher is already
      // enumerating waits behind it, and that is what made the first hover after
      // a focus change appear seconds late. Presentation takes the last complete
      // enumeration instead of queueing, because the identity of every row is
      // revalidated before anything is done with it.
      const helperBusy = lifecycleRefresh !== null || nativeCandidateListsInFlight > 0;
      const recent = preferRecentLifecycle && lifecycleLastObservations !== null
        && factory.revision === lifecycleRevision
        && (stamp() - lifecycleLastObservedAt <= 1000 || helperBusy);
      let result: WindowCapabilityResult = recent
        ? { outcome: 'success', windows: lifecycleLastObservations! }
        : await factory.list();
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
      const eligible = (result.windows ?? []).filter((observation) =>
        observation.bounds && trustedProcessId(observation, currentPid, allowCurrentProcessWindow) !== null
      ).slice(0, WINDOW_CAPABILITY_MAX_CANDIDATES);
      // The visible list uses cached/executable artwork. Start independent
      // Electron icon reads together instead of waiting for each window in
      // sequence before the chooser can appear. Native helper icon requests
      // remain serial so the single-request helper is not flooded.
      const entries = eligible.map(candidateForObservation);
      if (nativeIcons) {
        for (let index = 0; index < entries.length; index += 1) {
          entries[index]!.candidate.icon = await nativeIconFor(eligible[index]!);
        }
      } else {
        let nextIndex = 0;
        await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
          while (nextIndex < entries.length) {
            const index = nextIndex++;
            entries[index]!.candidate.icon = await iconFor(eligible[index]!);
          }
        }));
      }
      for (const entry of entries) {
        candidates.push(entry.candidate);
        listed.set(entry.candidate.id, entry);
      }
      for (const entry of listed.values()) rememberCandidate(entry);
      return { outcome: 'success', candidates };
    } finally {
      if (nativeIcons) {
        nativeCandidateListsInFlight -= 1;
        runLifecycleCatchupIfUnblocked();
      }
    }
  }

  function lifecycleSnapshot(complete: boolean, error?: string): WindowInstanceSnapshot {
    return {
      complete,
      trackerSessionId: lifecycleTrackerSessionId,
      sequence: lifecycleSequence,
      windows: complete ? [...lifecycleCurrent.keys()].map((windowInstanceId) => ({ windowInstanceId })) : [],
      ...(error ? { error } : {}),
    };
  }

  async function refreshWindowLifecycleOnce(pushBaseline = false): Promise<WindowInstanceSnapshot> {
    if (stopped) return lifecycleSnapshot(false, 'service is stopped');
    if (!(await ensureStarted())) return lifecycleSnapshot(false, 'window helper is unavailable');
    let result = await factory.list();
    if (result.outcome === 'timeout') result = await factory.list();
    if (result.outcome !== 'success' || !Array.isArray(result.windows)) {
      return lifecycleSnapshot(false, result.error ?? 'window enumeration is incomplete');
    }
    if (lifecycleBaselinePending) pushBaseline = true;
    if (factory.revision !== lifecycleRevision) {
      lifecycleRevision = factory.revision;
      lifecycleTrackerSessionId = randomUUID();
      lifecycleSequence = 0;
      lifecycleCurrent.clear();
      pushBaseline = true;
    }
    lifecycleLastObservations = [...result.windows];
    lifecycleLastObservedAt = stamp();
    const next = new Map<string, { token: RuntimeWindowId; observation: WindowObservation }>();
    for (const observation of result.windows) {
      if (trustedProcessId(observation, currentPid, allowCurrentProcessWindow) === null || !observation.bounds) continue;
      // Lifecycle membership requires helper-issued stable process identity;
      // never synthesize one from a per-session token or HWND alone.
      const instanceId = observation.windowInstanceId;
      if (typeof instanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(instanceId)
        || typeof observation.processStartTicks !== 'string' || !/^\d{1,20}$/.test(observation.processStartTicks)) continue;
      const collision = next.get(instanceId);
      if (collision && collision.token !== observation.runtimeId) {
        return lifecycleSnapshot(false, 'window instance identity is ambiguous');
      }
      next.set(instanceId, { token: observation.runtimeId, observation });
    }
    if (lifecycleBaselinePending) lifecycleBaselinePending = false;
    const previous = lifecycleCurrent;
    lifecycleCurrent = next;
    if (pushBaseline) {
      const baseline = lifecycleSnapshot(true);
      for (const subscriber of lifecycleSubscribers) {
        try { subscriber.onBaseline(baseline); } catch { /* consumer delivery is isolated */ }
      }
    } else {
      for (const [windowInstanceId, current] of next) {
        if (previous.has(windowInstanceId)) continue;
        const event: WindowLifecycleEvent = {
          kind: 'open', windowInstanceId, trackerSessionId: lifecycleTrackerSessionId,
          sequence: ++lifecycleSequence,
          observation: { bounds: current.observation.bounds!, state: current.observation.state },
        };
        for (const subscriber of lifecycleSubscribers) {
          try { subscriber.onEvent(event); } catch { /* consumer delivery is isolated */ }
        }
      }
      for (const windowInstanceId of previous.keys()) {
        if (next.has(windowInstanceId)) continue;
        const event: WindowLifecycleEvent = {
          kind: 'gone', windowInstanceId, trackerSessionId: lifecycleTrackerSessionId,
          sequence: ++lifecycleSequence,
        };
        for (const subscriber of lifecycleSubscribers) {
          try { subscriber.onEvent(event); } catch { /* consumer delivery is isolated */ }
        }
      }
    }
    return lifecycleSnapshot(true);
  }

  function refreshWindowLifecycle(pushBaseline = false): Promise<WindowInstanceSnapshot> {
    if (lifecycleRefreshBlocked()) {
      lifecycleCatchupRequired = true;
      if (pushBaseline) lifecycleBaselinePending = true;
      if (!lifecycleRefreshDeferred) {
        lifecycleRefreshDeferred = new Promise<WindowInstanceSnapshot>((resolve) => { resolveLifecycleRefreshDeferred = resolve; });
      }
      return lifecycleRefreshDeferred;
    }
    // Keep helper enumerations serialized. Overlapping slow list requests could
    // otherwise apply stale snapshots out of order and emit false retirements.
    if (lifecycleRefresh) {
      if (pushBaseline) lifecycleBaselinePending = true;
      return lifecycleRefresh;
    }
    const pending = refreshWindowLifecycleOnce(pushBaseline);
    lifecycleRefresh = pending.finally(() => { lifecycleRefresh = null; });
    return lifecycleRefresh;
  }

  async function windowLifecycleSnapshot(): Promise<{ snapshot: WindowInstanceSnapshot }> {
    return { snapshot: await refreshWindowLifecycle() };
  }

  async function resolveWindowInstance(windowInstanceId: string): Promise<WindowResolveResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    if (!/^W[0-9a-f]{16}$/i.test(windowInstanceId)) return { outcome: 'missing', error: 'window instance is not recognized' };
    const current = lifecycleCurrent.get(windowInstanceId);
    if (!current || current.observation.windowInstanceId !== windowInstanceId) return { outcome: 'missing', error: 'window instance is no longer live' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const observed = await factory.observe(current.token);
    if (observed.outcome !== 'success' || !observed.observation) {
      return { outcome: observed.outcome === 'timeout' ? 'timeout' : observed.outcome === 'missing' ? 'missing' : 'helper-unavailable', error: observed.error };
    }
    if (trustedProcessId(observed.observation, currentPid, allowCurrentProcessWindow) === null
      || !observed.observation.bounds || observed.observation.windowInstanceId !== windowInstanceId
      || observed.observation.processStartTicks !== current.observation.processStartTicks) {
      return { outcome: 'missing', error: 'window instance identity changed' };
    }
    const entry = candidateForObservation(observed.observation);
    const capability = issueBinding(entry.helperToken, observed.observation);
    bindingDescriptors.set(capability.bindingId!, entry.descriptor);
    return { outcome: 'success', capability, descriptor: { ...entry.descriptor, windowInstanceId } };
  }

  function watchWindowLifecycle(callbacks: {
    onEvent: (event: WindowLifecycleEvent) => void;
    onBaseline: (snapshot: WindowInstanceSnapshot) => void;
  }): () => void {
    if (stopped || lifecycleSubscribers.size >= WINDOW_CAPABILITY_MAX_SUBSCRIBERS) return () => undefined;
    lifecycleSubscribers.add(callbacks);
    void refreshWindowLifecycle(true);
    if (!lifecycleTimer) {
      lifecycleTimer = setInterval(() => { void refreshWindowLifecycle(); }, WINDOW_CAPABILITY_OBSERVE_CADENCE_MS);
      lifecycleTimer.unref?.();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      lifecycleSubscribers.delete(callbacks);
      if (lifecycleSubscribers.size === 0 && lifecycleTimer) {
        clearInterval(lifecycleTimer);
        lifecycleTimer = null;
      }
    };
  }

  async function iconFor(observation: WindowObservation): Promise<string | null> {
    const processPath = observation.processPath;
    if (typeof processPath !== 'string' || processPath.length === 0) return null;
    const artworkPath = observation.iconProcessPath ?? processPath;
    const cacheKey = `${observation.processId}|${artworkPath}`;
    const cached = iconCache.get(cacheKey);
    if (cached !== undefined) {
      // Keep recent artwork resident; a long session sees more than 64
      // processes, and a permanently full cache used to make every new icon
      // fail until Papers restarted.
      iconCache.delete(cacheKey);
      iconCache.set(cacheKey, cached);
      return cached;
    }
    const pending = iconReadsInFlight.get(cacheKey);
    if (pending) return pending;
    const rememberIcon = (icon: string): string => {
      iconCache.set(cacheKey, icon);
      while (iconCache.size > WINDOW_CAPABILITY_MAX_ICON_CACHE) {
        const oldest = iconCache.keys().next().value;
        if (oldest === undefined) break;
        iconCache.delete(oldest);
      }
      return icon;
    };
    const read = (async () => {
      try {
        const packageIcon = packagedAppLogo(artworkPath);
        if (packageIcon) {
          return rememberIcon(packageIcon);
        }
        const image = await getFileIcon(artworkPath);
        const dataUrl = image.toDataURL();
        if (Buffer.byteLength(dataUrl, 'utf8') > 256 * 1024) return null;
        return rememberIcon(dataUrl);
      } catch {
        return null;
      } finally {
        iconReadsInFlight.delete(cacheKey);
      }
    })();
    iconReadsInFlight.set(cacheKey, read);
    return read;
  }

  /** Resolve the exact window/class icon for a trusted observation. The
   * helper's bounded 48x48 request is strictly correlated to this runtime
   * identity and falls back to the executable icon.
   *
   * The round-trip is the expensive part, and an icon does not change for a
   * stable window identity, so it is resolved once per identity and every later
   * list is served from memory. Identity carries process start ticks, so a
   * recycled handle cannot inherit a stale icon. */
  async function nativeIconFor(observation: WindowObservation): Promise<string | null> {
    // Packaged apps commonly expose a generic HWND/class icon. Their own
    // AppxManifest logo is the app identity shown by Windows.
    const packageIcon = packagedAppLogo(observation.iconProcessPath ?? observation.processPath ?? '');
    if (packageIcon) return packageIcon;
    const identity = observation.windowInstanceId;
    const cacheable = typeof identity === 'string' && /^W[0-9a-f]{16}$/i.test(identity);
    if (cacheable) {
      const cached = nativeIconCache.get(identity);
      if (cached !== undefined) {
        nativeIconCache.delete(identity);
        nativeIconCache.set(identity, cached);
        return cached;
      }
      const pending = nativeIconReadsInFlight.get(identity);
      if (pending !== undefined) return pending;
    }
    const read = (async (): Promise<string | null> => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const result = await factory.thumbnail(observation.runtimeId, 48, 48);
            if (result.outcome === 'success' && result.thumbnail?.source === 'icon') {
              const icon = `data:image/png;base64,${result.thumbnail.image}`;
              if (cacheable) rememberNativeIcon(identity, icon);
              return icon;
            }
          } catch {
            // Retry one transient helper failure before taking a fallback.
          }
        }
        // Electron's executable fallback is not reliable for packaged Windows
        // apps such as Notepad. Leave these unresolved for the widget to retry
        // rather than caching a misleading generic glyph as the member icon.
        if (/(?:^|[\\/])WindowsApps(?:[\\/]|$)/i.test(observation.processPath ?? '')) return null;
        return await iconFor(observation);
      } finally {
        if (cacheable) nativeIconReadsInFlight.delete(identity);
      }
    })();
    if (cacheable) nativeIconReadsInFlight.set(identity, read);
    return read;
  }

  function rememberNativeIcon(identity: string, icon: string): void {
    nativeIconCache.set(identity, icon);
    while (nativeIconCache.size > WINDOW_CAPABILITY_MAX_NATIVE_ICON_CACHE) {
      const oldest = nativeIconCache.keys().next().value;
      if (oldest === undefined) break;
      nativeIconCache.delete(oldest);
    }
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
      ...(observation.windowInstanceId ? { windowInstanceId: observation.windowInstanceId } : {}),
    };
    const candidate: WindowCandidate = {
      id,
      title: boundedTitle(observation.title),
      applicationLabel: appLabel(observation.processPath ?? ''),
      icon: null,
      state: observation.state,
      ...(observation.windowInstanceId ? { windowInstanceId: observation.windowInstanceId } : {}),
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
    rememberCandidate(entry);
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

  function issueBinding(token: RuntimeWindowId, observation?: WindowObservation): WindowRuntimeCapability {
    const bindingId = `wl-binding-${candidateIdCounter}-${Math.random().toString(36).slice(2, 12)}`;
    if (bindings.size >= 128) {
      const oldest = [...bindings.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) { bindings.delete(oldest[0]); bindingObservations.delete(oldest[0]); bindingDescriptors.delete(oldest[0]); }
    }
    bindings.set(bindingId, { helperToken: token, touched: Date.now() });
    if (observation) bindingObservations.set(bindingId, observation);
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
    const capability = issueBinding(entry.helperToken, observed.observation);
    const bindingId = capability.bindingId;
    if (!bindingId) return { outcome: 'helper-unavailable', error: 'binding failed' };
    const descriptor = entry.descriptor;
    bindingDescriptors.set(bindingId, descriptor);
    return { outcome: 'success', capability, descriptor };
  }

  async function observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) {
      recordObserveFailure(capability, 'binding is not issued');
      return { outcome: 'missing', error: 'binding is not issued' };
    }
    if (!(await ensureStarted())) {
      recordObserveFailure(capability, 'window helper is unavailable');
      return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    }
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
    const result = await factory.minimize(token);
    recordStateChange('minimize', capability, result);
    return result;
  }

  async function toggleCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    if (factory.toggle) return factory.toggle(token);
    // An older helper has no atomic toggle. Fall back to the two-request shape
    // rather than failing: the caller gets the same typed answer, just without
    // the latency win. Optional capabilities fail closed everywhere else here,
    // but this one has an exact, already-proven equivalent.
    const observed = await factory.observe(token);
    if (observed.outcome !== 'success' || !observed.observation) return observed;
    const action = observed.observation.state === 'minimized' ? 'restore' : 'minimize';
    const mutated = action === 'restore' ? await factory.restore(token) : await factory.minimize(token);
    if (mutated.outcome !== 'success') return mutated;
    return { outcome: 'success', observation: observed.observation, action };
  }

  async function restoreCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const result = await factory.restore(token);
    recordStateChange('restore', capability, result);
    return result;
  }

  async function closeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    return factory.close(token);
  }

  async function endProcessCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    const bindingId = capability.bindingId ?? '';
    const issued = bindingObservations.get(bindingId);
    if (!token || !issued) return { outcome: 'missing', error: 'binding is not issued' };
    if (issued.processId === currentPid) return { outcome: 'denied', error: 'the Papers process cannot be ended here' };
    if (typeof issued.processStartTicks !== 'string' || typeof issued.processPath !== 'string' || !issued.windowInstanceId) {
      return { outcome: 'denied', error: 'the exact process identity is unavailable' };
    }
    if (/(?:^|[\\/])Windows(?:[\\/]|$)/i.test(issued.processPath)) {
      return { outcome: 'denied', error: 'Windows system processes cannot be ended here' };
    }
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const observed = await factory.observe(token);
    if (observed.outcome !== 'success' || !observed.observation) {
      return { outcome: observed.outcome === 'timeout' ? 'timeout' : observed.outcome, error: observed.error };
    }
    const live = observed.observation;
    if (live.processId !== issued.processId || live.processStartTicks !== issued.processStartTicks
      || live.processPath !== issued.processPath || live.windowInstanceId !== issued.windowInstanceId) {
      return { outcome: 'denied', error: 'the exact process identity changed' };
    }
    if (!factory.endProcess) return { outcome: 'helper-unavailable', error: 'the window helper cannot safely end a process' };
    return factory.endProcess(token);
  }

  async function endPeek(): Promise<WindowCapabilityResult> {
    peekGeneration += 1;
    // Release first and unconditionally, like endLivePreview: an end with
    // nothing to restore must still let the periodic enumeration resume.
    releaseLifecycleForPeek();
    const restore = [...peekRestoreTokens];
    const reminimize = peekMinimizedTarget;
    if (!factoryBuilt || stopped) return { outcome: 'success' };
    let firstFailure: WindowCapabilityResult | null = null;
    if (restore.length > 0 && factory.uncloakMany) {
      let result: WindowCapabilityResult;
      try { result = await factory.uncloakMany([...restore].reverse()); }
      catch (error) { result = { outcome: 'helper-unavailable', error: String(error) }; }
      if (result.outcome === 'success') {
        peekRestoreTokens = peekRestoreTokens.filter((token) => !restore.includes(token));
      } else firstFailure = result;
    } else {
      for (const token of [...restore].reverse()) {
        let result: WindowCapabilityResult;
        try { result = factory.uncloak ? await factory.uncloak(token) : { outcome: 'helper-unavailable', error: 'window reveal is unavailable' }; }
        catch (error) { result = { outcome: 'helper-unavailable', error: String(error) }; }
        if (result.outcome === 'success') peekRestoreTokens = peekRestoreTokens.filter((entry) => entry !== token);
        else firstFailure ??= result;
      }
    }
    if (reminimize) {
      let result: WindowCapabilityResult;
      try { result = await factory.minimize(reminimize); }
      catch (error) { result = { outcome: 'helper-unavailable', error: String(error) }; }
      if (result.outcome === 'success' && peekMinimizedTarget === reminimize) peekMinimizedTarget = null;
      else firstFailure ??= result;
    }
    if (firstFailure) return firstFailure;
    return { outcome: 'success' };
  }

  async function beginPeekCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const target = tokenFor(capability);
    if (!target) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    // A cloak peek also holds the periodic enumeration off for its session, so
    // shifting across icons does not queue behind the 500 ms watcher.
    holdLifecycleForPeek();

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
    // Release first and unconditionally: an end with no recorded preview, or an
    // end after a failed begin, must never strand the peek's hold.
    releaseLifecycleForPeek();
    const activePreview = livePreview;
    if (!activePreview || !factory.livePreview || stopped) return { outcome: 'success' };
    let result: WindowCapabilityResult;
    try { result = await factory.livePreview(activePreview.target, activePreview.caller, false); }
    catch (error) { result = { outcome: 'helper-unavailable', error: String(error) }; }
    if (result.outcome === 'success' && livePreview === activePreview) livePreview = null;
    return result;
  }

  async function beginLivePreviewCapability(capability: WindowRuntimeCapability, caller: string): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const target = tokenFor(capability);
    if (!target) return { outcome: 'missing', error: 'binding is not issued' };
    if (!/^[1-9][0-9]{0,19}$/.test(caller)) return { outcome: 'malformed', error: 'caller window is malformed' };
    if (!(await ensureStarted()) || !factory.livePreview) return { outcome: 'helper-unavailable', error: 'DWM live preview is unavailable' };
    if (livePreview?.target === target && livePreview.caller === caller) return { outcome: 'success' };
    // A peek session holds the periodic enumeration off exactly like a chooser
    // does: shifting across member icons drives one preview request per icon,
    // and every one of them shares the helper with the 500 ms watcher.
    holdLifecycleForPeek();
    // DWM replaces the active preview when enabled for another target. An
    // explicit disable here exposed the entire desktop between list rows.
    // Record release intent before the helper call. If begin times out after
    // DWM accepted it, a later picker cleanup still knows what to disable.
    const preview = { target, caller };
    livePreview = preview;
    const result = await factory.livePreview(target, caller, true);
    if (result.outcome !== 'success') {
      // Begin can partially succeed (for example, after IPC timeout). Try to
      // undo it now and retain the intent if that cleanup itself fails.
      await endLivePreview();
    }
    return result;
  }

  async function applyCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    const result = await factory.apply(token, bounds);
    // Diagnostic: what was asked for versus what the window actually had after
    // the helper's offscreen clamp. This is what tells a bad remembered
    // rectangle apart from a clamp that produced a tiny window in a corner.
    try {
      geometryJournal.record({
        kind: 'apply',
        title: descriptorForBinding(capability.bindingId ?? '')?.title ?? '',
        requested: bounds,
        observed: result.observation?.bounds ?? null,
        workAreas: monitorWorkAreas(),
        outcome: result.outcome,
      });
    } catch {
      /* diagnostics never fail the action they describe */
    }
    return result;
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
      // Native icons are tied to a helper session's window identities too.
      nativeIconCache.clear();
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

    thumbnailsInFlight += 1;
    let result: WindowCapabilityResult;
    try {
      result = await factory.thumbnail(token, maxWidth.value, maxHeight.value);
    } finally {
      thumbnailsInFlight = Math.max(0, thumbnailsInFlight - 1);
      runLifecycleCatchupIfUnblocked();
    }
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
    const seeds: Array<NativePickerWindowIdentity & { seedId: number }> = [];
    const seededIndices: number[] = [];
    const claimed = new Set<string>();
    for (const [memberIndex, descriptor] of memberDescriptors.entries()) {
      if (descriptor.windowInstanceId !== undefined
        && (typeof descriptor.windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(descriptor.windowInstanceId))) {
        return { outcome: 'ambiguous', error: `layout member identity is invalid: ${descriptor.title}` };
      }
      const matches = snapshot.observations.filter((observation) => {
        const candidate = candidateForObservation(observation);
        if (descriptor.windowInstanceId !== undefined) {
          return candidate.descriptor.windowInstanceId === descriptor.windowInstanceId;
        }
        return candidate.descriptor.executableFingerprint === descriptor.executableFingerprint
          && candidate.descriptor.title === descriptor.title;
      });
      if (descriptor.windowInstanceId !== undefined && matches.length === 0) {
        const unresolvedLegacy = snapshot.observations.some((observation) => {
          const candidate = candidateForObservation(observation);
          return candidate.descriptor.windowInstanceId === undefined
            && candidate.descriptor.executableFingerprint === descriptor.executableFingerprint
            && candidate.descriptor.title === descriptor.title;
        });
        if (unresolvedLegacy) {
          return { outcome: 'ambiguous', error: `layout member identity is ambiguous: ${descriptor.title}` };
        }
      }
      // A persisted layout may legitimately contain a closed window. It cannot
      // be painted green, but it must not prevent the creator from opening the
      // picker to add/remove the windows that are currently on screen.
      if (matches.length === 0) continue;
      if (matches.length > 1) return { outcome: 'ambiguous', error: `layout member is ambiguous: ${descriptor.title}` };
      const identity = nativeIdentity(matches[0]!);
      if (!identity) continue;
      const key = `${identity.processId}|${identity.x}|${identity.y}|${identity.width}|${identity.height}`;
      // Some hosts expose more than one logical observation for one native
      // top-level rectangle (for example a Directory Opus surface plus its
      // cleanup-labelled companion). The local AHK picker can paint that
      // rectangle only once, so collapse it instead of bricking the entire
      // direct-pick session.
      if (claimed.has(key)) continue;
      claimed.add(key);
      // The seed carries its member index: a removal is then a session-local id,
      // valid even if that window moves or closes before Enter is pressed.
      seeds.push({ ...identity, seedId: memberIndex });
      seededIndices.push(memberIndex);
    }
    return { outcome: 'success', seeds, seededIndices };
  }

  async function bindNativePickerSelection(
    selections: NativePickerWindowIdentity[],
    unchangedMembers: PersistedWindowMemberDescriptor[] = [],
  ): Promise<NativePickerBindResult> {
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
      // EnumWindows/helper order is topmost-first. If one native PID/rectangle
      // is represented by multiple logical observations, the first is the
      // window AHK actually hit; rejecting the complete set would make Direct
      // Pick permanently unavailable for that desktop state.
      const first = matches[0]!;
      // A window that is ALREADY a member needs nothing: the project holds its
      // capability and its icon, and the commit only has to name the new ones.
      // Binding the whole final set made every commit pay one icon read plus one
      // bind per member through the single helper - thirteen members meant
      // twenty-six ordered calls, and the creator waited seconds for a pick that
      // added one window.
      if (unchangedMembers.some((member) =>
        compareWindowMemberIdentity(member, candidateForObservation(first).descriptor) === 'same')) {
        continue;
      }
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
    // A peek session's hold must not outlive the service.
    releaseLifecycleForPeek();
    // Shutdown must not strand a caller waiting on a deferred snapshot: answer
    // it with an honest stopped snapshot and clear the blocker state.
    candidatePickerHolds = 0;
    lifecycleCatchupRequired = false;
    const strandedResolve = resolveLifecycleRefreshDeferred;
    lifecycleRefreshDeferred = null;
    resolveLifecycleRefreshDeferred = null;
    strandedResolve?.(lifecycleSnapshot(false, 'service is stopped'));
    if (lifecycleTimer) clearInterval(lifecycleTimer);
    lifecycleTimer = null;
    lifecycleSubscribers.clear();
    lifecycleCurrent.clear();
    lifecycleLastObservations = null;
    lifecycleLastObservedAt = Number.NEGATIVE_INFINITY;
    candidatesByListedId.clear();
    bindings.clear();
    bindingObservations.clear();
    bindingDescriptors.clear();
    observations.clear();
    thumbnailCache.clear();
    lastFrameCache.clear();
    nativeIconCache.clear();
    nativeIconReadsInFlight.clear();
    frameSeedAt.clear();
    frameSeedInFlight.clear();
    thumbnailCacheRevision = -1;
    if (factoryBuilt) {
      await factory.stop().catch(() => undefined);
    }
  }

  return {
    listCandidates,
    windowLifecycleSnapshot,
    resolveWindowInstance,
    watchWindowLifecycle,
    holdWindowLifecycleRefresh,
    bindCandidate,
    observeCapability,
    minimizeCapability,
    restoreCapability,
    toggleCapability,
    closeCapability,
    endProcessCapability,
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
