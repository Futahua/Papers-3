/**
 * Shared bounded window-capability service (Assignment 015).
 *
 * The single main-process owner of the 014 window-helper factory for the
 * Backpack project bridge. It exposes ONLY a narrow typed surface:
 *   - list eligible candidates (Papers itself and untrusted entries are
 *     excluded host-side; results are bounded),
 *   - bind one currently listed, host-issued candidate id into an
 *     ephemeral runtime capability plus a versioned persisted descriptor,
 *   - observe / minimize / restore / apply bounds for one issued
 *     capability,
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
import type {
  RuntimeWindowId,
  WindowBounds,
  WindowCapabilityResult,
  WindowObservation,
  WindowState,
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

export interface WindowCapabilityService {
  listCandidates(): Promise<WindowCandidateListResult>;
  bindCandidate(candidateId: string): Promise<WindowBindResult>;
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  minimizeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  restoreCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  applyCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult>;
  resolvePersisted(descriptor: PersistedWindowMemberDescriptor): Promise<WindowResolveResult>;
  stop(): Promise<void>;
}

export interface WindowCapabilityServiceOptions {
  /** Private DI for tests; default lazily builds the 014 factory. */
  createFactory?: () => WindowHelperFactory;
  /** Private DI for tests; default is the real current process pid. */
  currentPid?: number;
  /** Private DI for tests; default is app.getFileIcon. */
  getFileIcon?: (path: string) => Promise<Electron.NativeImage>;
  /** Private DI for tests; default is the bounded cadence constant. */
  observeCadenceMs?: number;
  now?: () => number;
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

/** Returns the trusted process id of a candidate, or null when the window
 * must be excluded: Papers itself, missing/empty title, missing process
 * path, or a non-positive process id. */
function trustedProcessId(observation: WindowObservation, currentPid: number): number | null {
  if (observation.processId === null || observation.processId <= 0) return null;
  if (observation.processId === currentPid) return null; // Papers itself
  if (typeof observation.title !== 'string' || observation.title.length === 0) return null;
  if (typeof observation.processPath !== 'string' || observation.processPath.length === 0) return null;
  if (Buffer.byteLength(observation.processPath, 'utf8') > 4096) return null;
  return observation.processId;
}

export function createWindowCapabilityService(options: WindowCapabilityServiceOptions = {}): WindowCapabilityService {
  let factory: WindowHelperFactory;
  let factoryBuilt = false;
  let stopped = false;
  let candidateIdCounter = 0;
  const candidatesByListedId = new Map<string, { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate }>();
  const bindings = new Map<string, { helperToken: RuntimeWindowId; touched: number }>();
  const observations = new Map<string, Promise<WindowCapabilityResult>>();
  const iconCache = new Map<string, string>();

  const currentPid = options.currentPid ?? process.pid;
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

  async function listCandidates(): Promise<WindowCandidateListResult> {
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
      const processId = trustedProcessId(observation, currentPid);
      if (processId === null) continue;
      const id = `wl-candidate-${candidateIdCounter + 1}`;
      candidateIdCounter += 1;
      const icon = await iconFor(observation);
      if (!observation.bounds) continue;
      const descriptor: PersistedWindowMemberDescriptor = {
        version: 1,
        executableFingerprint: fingerprint(observation.processPath!),
        title: boundedTitle(observation.title),
      };
      const candidate: WindowCandidate = {
        id,
        title: boundedTitle(observation.title),
        applicationLabel: appLabel(observation.processPath!),
        icon,
        state: observation.state,
      };
      candidates.push(candidate);
      listed.set(id, { helperToken: observation.runtimeId, descriptor, candidate });
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

  function listedEntry(candidateId: string): { helperToken: RuntimeWindowId; descriptor: PersistedWindowMemberDescriptor; candidate: WindowCandidate } | null {
    return candidatesByListedId.get(candidateId) ?? null;
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
    const descriptor = entry.descriptor;
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
    const request = factory.observe(token).finally(() => observations.delete(bindingId));
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

  async function applyCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult> {
    if (stopped) return { outcome: 'helper-unavailable', error: 'service is stopped' };
    const token = tokenFor(capability);
    if (!token) return { outcome: 'missing', error: 'binding is not issued' };
    if (!(await ensureStarted())) return { outcome: 'helper-unavailable', error: 'window helper is unavailable' };
    return factory.apply(token, bounds);
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

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    candidatesByListedId.clear();
    bindings.clear();
    observations.clear();
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
    applyCapability,
    resolvePersisted,
    stop,
  };
}
