import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  createProjectVisualDiagnosticBridge,
  reportProjectFirstPaint,
  type ProjectVisualDiagnosticBridge,
} from './projectVisualDiagnostics';
import { installProjectVisualLayoutObserver } from './projectVisualLayoutObserver';
import { installProjectVisualSemanticKeyObserver } from './projectVisualSemanticKeys';
import { VISUAL_FENCE_REQUEST_CHANNEL, VISUAL_FENCE_RESPONSE_CHANNEL } from '@shared/visualSemanticKeyConstants';

const MAIN_WORLD_DIAGNOSTIC_BRIDGE = 'papersVisualDiagnosticBridgeV1';

function installVisualDiagnosticListeners(
  ipc: { send(channel: string, payload: unknown): void },
  mainWorld: {
    exposeInMainWorld(apiKey: string, api: ProjectVisualDiagnosticBridge): void;
    executeInMainWorld(script: { func: () => void }): unknown;
  },
): void {
  let refreshSemanticKeys = (): void => undefined;
  const diagnosticBridge = createProjectVisualDiagnosticBridge(ipc, () => refreshSemanticKeys());
  mainWorld.exposeInMainWorld(MAIN_WORLD_DIAGNOSTIC_BRIDGE, diagnosticBridge);
  // Keep first-paint emission Papers-owned while observing the document's
  // browser-provided Paint Timing entries in this preload world.
  try {
    let firstPaintReported = false;
    const reportFirstPaint = (entryName: unknown): void => {
      if (firstPaintReported || entryName !== 'first-paint') return;
      firstPaintReported = true;
      reportProjectFirstPaint(ipc);
    };
    const paintObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => reportFirstPaint(entry.name));
      if (firstPaintReported) paintObserver.disconnect();
    });
    paintObserver.observe({ type: 'paint', buffered: true });
    performance.getEntriesByType('paint').forEach((entry) => reportFirstPaint(entry.name));
    if (firstPaintReported) paintObserver.disconnect();
  } catch {
    // Paint Timing is a browser-provided optional signal. Absence of the
    // API leaves first-paint unknown; it is never inferred from load or DOM readiness.
  }
  try {
    installProjectVisualLayoutObserver(ipc, {
      document,
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      ResizeObserver: typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver,
      MutationObserver: typeof MutationObserver === 'undefined' ? undefined : MutationObserver,
    });
  } catch {
    // Missing observer APIs leave layout stability unknown; no success is synthesized.
  }
  try {
    refreshSemanticKeys = installProjectVisualSemanticKeyObserver(ipc, {
      document,
      MutationObserver: typeof MutationObserver === 'undefined' ? undefined : MutationObserver,
    });
  } catch {
    // Semantic observation is diagnostic-only and must never affect startup.
  }
  try {
    void Promise.resolve(mainWorld.executeInMainWorld({ func: () => {
      const page = window as unknown as {
        papersVisualDiagnosticBridgeV1?: ProjectVisualDiagnosticBridge;
        __papersVisualDiagnosticObserverV1?: boolean;
      };
      // The isolated-world bridge can become visible to the page a moment
      // after this document-start callback runs. Install the listeners
      // unconditionally and resolve the bridge when an event is delivered;
      // otherwise an early bridge lookup would silently miss bootstrap
      // failures from the project's first script.
      if (page.__papersVisualDiagnosticObserverV1) return;
      Object.defineProperty(page, '__papersVisualDiagnosticObserverV1', { value: true, configurable: false, enumerable: false });
      const report = (kind: 'uncaught-error' | 'unhandled-rejection', message: unknown) => {
        const bridge = page.papersVisualDiagnosticBridgeV1;
        if (!bridge) return;
        bridge.report(kind, typeof message === 'string' && message.length > 0 ? message.slice(0, 4096) :
          (kind === 'uncaught-error' ? 'uncaught error' : 'unhandled rejection'));
      };
      window.addEventListener('error', (event) => report('uncaught-error', event.message));
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        report('unhandled-rejection', reason instanceof Error ? reason.message :
          reason !== null && typeof reason === 'object' && typeof reason.message === 'string' ? reason.message :
            typeof reason === 'string' ? reason : 'unhandled rejection');
      });
    } })).catch(() => undefined);
  } catch {
    // A build without main-world execution leaves diagnostics inert.
  }
}


installVisualDiagnosticListeners(ipcRenderer, contextBridge);

ipcRenderer.on(VISUAL_FENCE_REQUEST_CHANNEL, (_event, payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
  const requestId = (payload as { requestId?: unknown }).requestId;
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) return;
  ipcRenderer.send(VISUAL_FENCE_RESPONSE_CHANNEL, { requestId, ready: true });
});

interface ProjectMessage { operation?: unknown; params?: unknown; type?: unknown; requestId?: unknown; actionId?: unknown; text?: unknown; state?: unknown; revision?: unknown; url?: unknown; files?: unknown; kind?: unknown; candidateId?: unknown; candidates?: unknown; capability?: unknown; bounds?: unknown; descriptor?: unknown; members?: unknown; projectId?: unknown; transferId?: unknown; token?: unknown; layoutKey?: unknown; options?: unknown; width?: unknown; height?: unknown; imageUrl?: unknown; title?: unknown; anchor?: unknown; phase?: unknown; x?: unknown; y?: unknown; }

const WINDOW_CAPABILITY_MAX_STRING_BYTES = 512;
const WINDOW_CAPABILITY_MAX_BOUNDS = 32768;
const WINDOW_THUMBNAIL_MAX_WIDTH = 320;
const WINDOW_THUMBNAIL_MAX_HEIGHT = 180;
let detachedToken: string | null = null;
let detachedTransferId: string | null = null;
let detachedPageReady = false;
let detachedReadySent = false;
let widgetToken: string | null = null;
let widgetPageReady = false;
let widgetReadySent = false;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(raw).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseBoundedString(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > WINDOW_CAPABILITY_MAX_STRING_BYTES) {
    throw new Error('a bounded non-empty string is required');
  }
  return raw;
}

function parseCapability(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) throw new Error('capability must be an object');
  if (!exactKeys(raw, ['version', 'bindingId'])) throw new Error('capability contains unknown fields');
  if (raw['version'] !== 1) throw new Error('unsupported capability version');
  parseBoundedString(raw['bindingId']);
  return raw;
}

function parseBounds(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) throw new Error('bounds must be an object');
  if (!exactKeys(raw, ['x', 'y', 'width', 'height'])) throw new Error('bounds contains unknown fields');
  const bounds: Record<string, number> = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`bounds.${key} is invalid`);
    bounds[key] = value;
  }
  if (bounds['width']! <= 0 || bounds['height']! <= 0) throw new Error('bounds width and height must be positive');
  if (bounds['width']! > WINDOW_CAPABILITY_MAX_BOUNDS || bounds['height']! > WINDOW_CAPABILITY_MAX_BOUNDS
    || Math.abs(bounds['x']!) > WINDOW_CAPABILITY_MAX_BOUNDS || Math.abs(bounds['y']!) > WINDOW_CAPABILITY_MAX_BOUNDS) {
    throw new Error('bounds exceed the allowed range');
  }
  return bounds;
}

function parseDescriptor(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) throw new Error('descriptor must be an object');
  if (!exactKeys(raw, ['version', 'title', 'executableFingerprint'])) throw new Error('descriptor contains unknown fields');
  if (raw['version'] !== 1) throw new Error('unsupported descriptor version');
  parseBoundedString(raw['title']);
  const fingerprint = parseBoundedString(raw['executableFingerprint']);
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('descriptor.executableFingerprint is invalid');
  return raw;
}

function parsePickMembers(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) throw new Error('pick members must be an array');
  if (raw.length > 32) throw new Error('pick member list exceeds the bound');
  return raw.map(parseDescriptor);
}

/** 019G thumbnail request dimensions (page gate): options must be an object
 * with EXACT keys { maxWidth, maxHeight }, each a positive safe integer within
 * the 320x180 contract bounds. The 240x135 default is applied by the service,
 * never guessed here. */
function parseThumbnailOptions(raw: unknown): Record<string, number> {
  if (!isPlainObject(raw)) throw new Error('thumbnail options must be an object');
  if (!exactKeys(raw, ['maxWidth', 'maxHeight'])) throw new Error('thumbnail options contains unknown fields');
  const maxWidth = raw['maxWidth'];
  const maxHeight = raw['maxHeight'];
  if (typeof maxWidth !== 'number' || !Number.isSafeInteger(maxWidth) || maxWidth <= 0 || maxWidth > WINDOW_THUMBNAIL_MAX_WIDTH) {
    throw new Error('thumbnail options.maxWidth is invalid');
  }
  if (typeof maxHeight !== 'number' || !Number.isSafeInteger(maxHeight) || maxHeight <= 0 || maxHeight > WINDOW_THUMBNAIL_MAX_HEIGHT) {
    throw new Error('thumbnail options.maxHeight is invalid');
  }
  return { maxWidth, maxHeight };
}

function projectIdFromOrigin(): string {
  const projectId = new URL(window.location.href).host;
  if (!projectId) throw new Error('the project origin has no identity');
  return projectId;
}

function immediateHostResult(requestId: unknown, origin: string): void {
  if (typeof requestId !== 'string') return;
  window.postMessage({ type: 'papers:host:result', requestId, ok: true }, origin);
}

function immediateHostError(requestId: unknown, origin: string, error: string): void {
  if (typeof requestId !== 'string') return;
  window.postMessage({ type: 'papers:host:result', requestId, ok: false, error }, origin);
}

function validTransferId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function trySendDetachedReady(): void {
  if (!detachedPageReady || detachedReadySent || !detachedToken || !detachedTransferId) return;
  detachedReadySent = true;
  ipcRenderer.send('papers:backpack:detach-ready', {
    token: detachedToken,
    transferId: detachedTransferId,
  });
}

function trySendWidgetReady(): void {
  if (!widgetPageReady || widgetReadySent || !widgetToken) return;
  widgetReadySent = true;
  ipcRenderer.send('papers:backpack:widget-ready', { token: widgetToken });
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data as ProjectMessage;
  if (!request || typeof request.type !== 'string') return;
  if (request.type === 'papers:project:widget-drag') {
    if (!widgetToken || !exactKeys(request as Record<string, unknown>, ['type', 'phase', 'x', 'y'])
      || !['begin', 'move', 'end'].includes(String(request.phase))
      || typeof request.x !== 'number' || typeof request.y !== 'number'
      || !Number.isFinite(request.x) || !Number.isFinite(request.y)
      || Math.abs(request.x) > 100000 || Math.abs(request.y) > 100000) return;
    ipcRenderer.send('papers:backpack:widget-drag', {
      token: widgetToken,
      phase: request.phase,
      x: request.x,
      y: request.y,
    });
    return;
  }
  if (request.type === 'papers:project:detach-ready') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId']) || typeof request.requestId !== 'string') {
      immediateHostError(request.requestId, event.origin, 'detached ready request is malformed');
      return;
    }
    detachedPageReady = true;
    trySendDetachedReady();
    immediateHostResult(request.requestId, event.origin);
    return;
  }
  if (request.type === 'papers:project:widget-ready') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId']) || !validRequestId(request.requestId)) {
      immediateHostError(request.requestId, event.origin, 'widget ready request is malformed');
      return;
    }
    widgetPageReady = true;
    trySendWidgetReady();
    immediateHostResult(request.requestId, event.origin);
    return;
  }
  if (request.type === 'papers:project:close') { ipcRenderer.send('host:backpack-project:request-close'); return; }

  let task: Promise<unknown> | null = null;
  if (request.type === 'papers:project:run-action' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:run-action', request.actionId);
  if (request.type === 'papers:project:copy-text' && typeof request.text === 'string') task = ipcRenderer.invoke('host:backpack-project:copy-text', request.text);
  if (request.type === 'papers:project:as-you-go-load') task = ipcRenderer.invoke('host:backpack-project:state-load').then((state) => ({ state: JSON.stringify(state) }));
  if (request.type === 'papers:project:as-you-go-save' && typeof request.state === 'string') task = ipcRenderer.invoke('host:backpack-project:state-save', request.state);
  // Versioned pair, named without any Backpack's identity: a project asks for
  // the document plus its revision, then offers a save that names the revision
  // it was built on. Papers refuses the save if that revision is stale.
  if (request.type === 'papers:project:state-load-versioned') task = ipcRenderer.invoke('host:backpack-project:state-load-versioned').then((loaded) => ({ state: JSON.stringify((loaded as { state: unknown }).state), revision: (loaded as { revision: string }).revision }));
  // Wrapped under `stateSave`, like every other nested result here. A refused
  // save carries its own `ok: false`, and the transport envelope spreads the
  // payload over `ok: true` -- unwrapped, a stale revision would arrive at the
  // project as a failed request instead of the typed answer it is.
  if (request.type === 'papers:project:state-save-checked' && typeof request.state === 'string' && typeof request.revision === 'string') task = ipcRenderer.invoke('host:backpack-project:state-save-checked', request.state, request.revision).then((result) => ({ stateSave: result }));
  if (request.type === 'papers:project:as-you-go-pick-target' && (request.kind === 'file' || request.kind === 'folder')) task = ipcRenderer.invoke('host:backpack-project:pick-target', request.kind).then((selection) => ({ target: selection?.target ?? null, icon: selection?.icon ?? null }));
  if (request.type === 'papers:project:as-you-go-shortcut-icon' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:shortcut-icon', request.actionId).then((icon) => ({ icon }));
  if (request.type === 'papers:project:as-you-go-launch' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:launch-shortcut', request.actionId);
  if (request.type === 'papers:project:as-you-go-reveal' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:reveal-shortcut', request.actionId);
  if (request.type === 'papers:project:delegate-wave') {
    // The Backpack names an OPERATION; it never names a URL, a method or a path.
    // Its identity is attached here from the page origin, exactly as projectId
    // is elsewhere in this file, and never read from page data -- a page that
    // supplied its own backpackId would be claiming an authority it cannot have.
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'operation', 'params'])
      || !validRequestId(request.requestId) || typeof request.operation !== 'string') {
      immediateHostError(request.requestId, event.origin, 'delegate wave request is malformed');
      return;
    }
    const params = isPlainObject(request.params) ? request.params : {};
    task = ipcRenderer.invoke('host:backpack-project:delegate-wave', {
      backpackId: projectIdFromOrigin(),
      operation: request.operation,
      params,
    }).then((payload) => ({ delegateWave: payload }));
  }
  if (request.type === 'papers:project:open-web-link' && typeof request.url === 'string') task = ipcRenderer.invoke('host:backpack-project:open-web-link', request.url);
  if (request.type === 'papers:project:resolve-dropped-targets' && Array.isArray(request.files)) {
    const paths = request.files.filter((file): file is File => file instanceof File).map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    if (paths.length) task = ipcRenderer.invoke('host:backpack-project:resolve-dropped-targets', paths).then((targets) => ({ targets }));
  }
  if (request.type === 'papers:project:resolve-web-link-icon' && typeof request.url === 'string') task = ipcRenderer.invoke('host:backpack-project:resolve-web-link-icon', request.url);
  if (request.type === 'papers:project:window-candidates') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId'])) throw new Error('window candidate request contains unknown fields');
    task = ipcRenderer.invoke('papers:window-capability:list');
  }
  if (request.type === 'papers:project:window-bind-candidate') {
    const candidateId = parseBoundedString(request.candidateId);
    task = ipcRenderer.invoke('papers:window-capability:bind', candidateId);
  }
  if (request.type === 'papers:project:window-observe-capability') {
    const capability = parseCapability(request.capability);
    task = ipcRenderer.invoke('papers:window-capability:observe', capability);
  }
  if (request.type === 'papers:project:window-minimize-capability') {
    const capability = parseCapability(request.capability);
    task = ipcRenderer.invoke('papers:window-capability:minimize', capability);
  }
  if (request.type === 'papers:project:window-restore-capability') {
    const capability = parseCapability(request.capability);
    task = ipcRenderer.invoke('papers:window-capability:restore', capability);
  }
  if (request.type === 'papers:project:window-close-capability') {
    const capability = parseCapability(request.capability);
    task = ipcRenderer.invoke('papers:window-capability:close', capability);
  }
  if (request.type === 'papers:project:window-peek-begin') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'capability'])) throw new Error('window peek begin request contains unknown fields');
    const capability = parseCapability(request.capability);
    task = ipcRenderer.invoke('papers:window-capability:peek-begin', capability);
  }
  if (request.type === 'papers:project:window-peek-end') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId'])) throw new Error('window peek end request contains unknown fields');
    task = ipcRenderer.invoke('papers:window-capability:peek-end', {});
  }
  if (request.type === 'papers:project:window-apply-capability') {
    const capability = parseCapability(request.capability);
    const bounds = parseBounds(request.bounds);
    task = ipcRenderer.invoke('papers:window-capability:apply', { capability, bounds });
  }
  if (request.type === 'papers:project:window-resolve-descriptor') {
    const descriptor = parseDescriptor(request.descriptor);
    task = ipcRenderer.invoke('papers:window-capability:resolve', descriptor);
  }
  if (request.type === 'papers:project:window-thumbnail') {
    // 019G/019GR2: the final AYG page event is EXACTLY
    // `papers:project:window-thumbnail` with keys { capability,
    // options: { maxWidth, maxHeight } }; only the opaque capability and
    // bounded integer dimensions reach Papers, never an HWND/PID/path. The
    // page result shape is the strict typed thumbnail result (data-URL
    // success or a payload-free typed fallback).
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'capability', 'options']) || !validRequestId(request.requestId)) {
      immediateHostError(request.requestId, event.origin, 'window thumbnail request is malformed');
      return;
    }
    let capability: Record<string, unknown>;
    let options: Record<string, number>;
    try {
      capability = parseCapability(request.capability);
      options = parseThumbnailOptions(request.options);
    } catch {
      immediateHostError(request.requestId, event.origin, 'window thumbnail request is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:window-capability:thumbnail', { capability, options });
  }
  if (request.type === 'papers:project:window-pick-begin') {
    console.info('[045-direct-pick] preload-begin-received');
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'members'])) {
      throw new Error('window pick begin request contains unknown fields');
    }
    const members = parsePickMembers(request.members);
    task = ipcRenderer.invoke('papers:window-pick:begin', { members });
  }
  if (request.type === 'papers:project:window-pick-cancel') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId'])) {
      throw new Error('window pick cancel request contains unknown fields');
    }
    task = ipcRenderer.invoke('papers:window-pick:cancel', {});
  }
  if (request.type === 'papers:project:window-pick-stage') {
    // 021: the launching workspace page routes the toggle key (e.g. Space) to
    // the pick session; empty payload only.
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId'])) {
      throw new Error('window pick stage request contains unknown fields');
    }
    task = ipcRenderer.invoke('papers:window-pick:stage', {});
  }
  if (request.type === 'papers:project:window-pick-commit') {
    // 021: the launching workspace page routes Enter to commit the staged set;
    // empty payload only.
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId'])) {
      throw new Error('window pick commit request contains unknown fields');
    }
    task = ipcRenderer.invoke('papers:window-pick:commit', {});
  }
  if (request.type === 'papers:project:detach-open') {
    task = ipcRenderer.invoke('papers:backpack:detach-open', {
      projectId: projectIdFromOrigin(),
      ...(request.bounds !== undefined ? { bounds: request.bounds } : {}),
    });
  }
  if (request.type === 'papers:project:widget-close') {
    // 019C: the WORKSPACE frame closes a layout's widget by opaque layoutKey
    // (projectId attached here); the WIDGET frame closes itself by the hidden
    // token the preload latched. Exact keys, never a page-visible token.
    if (exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'layoutKey']) && validRequestId(request.requestId)) {
      let layoutKey: string;
      try { layoutKey = parseBoundedString(request.layoutKey); } catch {
        immediateHostError(request.requestId, event.origin, 'widget close request is malformed');
        return;
      }
      task = ipcRenderer.invoke('papers:backpack:widget-close', { projectId: projectIdFromOrigin(), layoutKey }).then((payload) => ({ widget: payload }));
    } else if (widgetToken && exactKeys(request as Record<string, unknown>, ['type', 'requestId']) && validRequestId(request.requestId)) {
      task = ipcRenderer.invoke('papers:backpack:widget-close', { token: widgetToken }).then((payload) => ({ widget: payload }));
    } else {
      immediateHostError(request.requestId, event.origin, 'widget close request is malformed');
      return;
    }
  }
  if (request.type === 'papers:project:widget-open') {
    // 019C: the registered live workspace opens/focuses a layout's compact
    // widget by opaque layoutKey; projectId is attached ONLY here, never from
    // page data. The opaque key is bounded and never parsed.
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'layoutKey']) || !validRequestId(request.requestId)) {
      immediateHostError(request.requestId, event.origin, 'widget open request is malformed');
      return;
    }
    let layoutKey: string;
    try { layoutKey = parseBoundedString(request.layoutKey); } catch {
      immediateHostError(request.requestId, event.origin, 'widget open request is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:backpack:widget-open', { projectId: projectIdFromOrigin(), layoutKey }).then((payload) => ({ widget: payload }));
  }
  if (request.type === 'papers:project:widget-focus') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'layoutKey']) || !validRequestId(request.requestId)) {
      immediateHostError(request.requestId, event.origin, 'widget focus request is malformed');
      return;
    }
    let layoutKey: string;
    try { layoutKey = parseBoundedString(request.layoutKey); } catch {
      immediateHostError(request.requestId, event.origin, 'widget focus request is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:backpack:widget-focus', { projectId: projectIdFromOrigin(), layoutKey }).then((payload) => ({ widget: payload }));
  }
  if (request.type === 'papers:project:widget-report-size') {
    // 024: the compact-widget page reports its bounded card content size after
    // each render so the host refits the frameless window to the card. Only the
    // latched widget token may report (the token never reaches the page body).
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'width', 'height']) || !widgetToken) {
      immediateHostError(request.requestId, event.origin, 'widget size report is malformed');
      return;
    }
    const width = request.width;
    const height = request.height;
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)
      || width < 1 || height < 1 || width > 2000 || height > 2000) {
      immediateHostError(request.requestId, event.origin, 'widget size report is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:backpack:widget-report-size', {
      token: widgetToken,
      width: Math.round(width),
      height: Math.round(height),
    }).then((payload) => ({ size: payload }));
  }
  if (request.type === 'papers:project:widget-preview-show') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'imageUrl', 'title', 'width', 'height', 'anchor']) || !widgetToken) {
      immediateHostError(request.requestId, event.origin, 'widget preview request is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:backpack:widget-preview-show', {
      token: widgetToken,
      imageUrl: request.imageUrl,
      title: request.title,
      width: request.width,
      height: request.height,
      anchor: request.anchor,
    }).then((payload) => ({ preview: payload }));
  }
  if (request.type === 'papers:project:widget-preview-hide') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId']) || !widgetToken) {
      immediateHostError(request.requestId, event.origin, 'widget preview hide request is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:backpack:widget-preview-hide', { token: widgetToken })
      .then((payload) => ({ preview: payload }));
  }
  if (request.type === 'papers:project:widget-context-menu') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId']) || !widgetToken) {
      immediateHostError(request.requestId, event.origin, 'widget context menu request is malformed');
      return;
    }
    task = ipcRenderer.invoke('papers:backpack:widget-context-menu', { token: widgetToken })
      .then((payload) => ({ menu: payload }));
  }
  if (request.type === 'papers:project:window-candidate-picker') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'candidates'])
      || !validRequestId(request.requestId) || !Array.isArray(request.candidates) || request.candidates.length > 64) {
      immediateHostError(request.requestId, event.origin, 'window candidate picker request is malformed');
      return;
    }
    const payload = widgetToken
      ? { token: widgetToken, candidates: request.candidates }
      : { projectId: projectIdFromOrigin(), candidates: request.candidates };
    task = ipcRenderer.invoke('papers:backpack:window-candidate-picker', payload)
      .then((value) => ({ picker: value }));
  }
  if (request.type === 'papers:project:window-candidate-picker-close') {
    if (!exactKeys(request as Record<string, unknown>, ['type', 'requestId']) || !validRequestId(request.requestId)) {
      immediateHostError(request.requestId, event.origin, 'window candidate picker close request is malformed');
      return;
    }
    const payload = widgetToken ? { token: widgetToken } : { projectId: projectIdFromOrigin() };
    task = ipcRenderer.invoke('papers:backpack:window-candidate-picker-close', payload)
      .then((value) => ({ picker: value }));
  }
  if (request.type === 'papers:project:detach-reattach') {
    task = detachedToken && detachedTransferId
      ? ipcRenderer.invoke('papers:backpack:detach-reattach', { token: detachedToken, transferId: detachedTransferId })
      : ipcRenderer.invoke('papers:backpack:detach-reattach', { projectId: projectIdFromOrigin() });
  }
  if (request.type === 'papers:project:detach-focus') {
    if (detachedToken && detachedTransferId) {
      task = ipcRenderer.invoke('papers:backpack:detach-focus', {
        token: detachedToken,
        transferId: detachedTransferId,
      });
    } else task = ipcRenderer.invoke('papers:backpack:detach-focus', { projectId: projectIdFromOrigin() });
  }
  if (request.type === 'papers:project:detach-stop-ack') {
    if (!validTransferId(request.transferId)) {
      immediateHostError(request.requestId, event.origin, 'detached stop acknowledgement is malformed');
      return;
    }
    ipcRenderer.send('papers:backpack:detach-stop-ack', { transferId: request.transferId });
    immediateHostResult(request.requestId, event.origin);
    return;
  }
  if (request.type === 'papers:project:detach-resumed-ack') {
    if (!validTransferId(request.transferId)) {
      immediateHostError(request.requestId, event.origin, 'detached resumed acknowledgement is malformed');
      return;
    }
    ipcRenderer.send('papers:backpack:detach-resumed', { transferId: request.transferId });
    immediateHostResult(request.requestId, event.origin);
    return;
  }
  if (!task) return;
  void task.then((payload) => window.postMessage({ type: 'papers:host:result', requestId: request.requestId, ok: true, ...(payload && typeof payload === 'object' ? payload : {}) }, event.origin))
    .catch((caught) => window.postMessage({ type: 'papers:host:result', requestId: request.requestId, ok: false, error: String(caught instanceof Error ? caught.message : caught) }, event.origin));
});


// The direct-pick session pushes its typed result to the project frame.
ipcRenderer.on('papers:window-pick:result', (_event, result) => {
  window.postMessage({ type: 'papers:project:window-pick-result', result }, window.location.origin);
});

// The same preload serves the workspace iframe and the top-level detached
// page. Tokens stay here; the project page sees only bounded lifecycle events.
ipcRenderer.on('papers:backpack:detach-token', (_event, payload) => {
  const value = payload as { token?: unknown; transferId?: unknown } | null;
  if (typeof value?.token !== 'string' || typeof value.transferId !== 'string') return;
  if (detachedToken !== value.token || detachedTransferId !== value.transferId) {
    detachedToken = value.token;
    detachedTransferId = value.transferId;
    detachedReadySent = false;
  }
  trySendDetachedReady();
});

ipcRenderer.on('papers:backpack:widget-token', (_event, payload) => {
  const value = payload as { token?: unknown } | null;
  if (typeof value?.token !== 'string' || value.token.length === 0 || value.token.length > 512) return;
  if (widgetToken !== value.token) {
    widgetToken = value.token;
    widgetReadySent = false;
  }
  trySendWidgetReady();
});

for (const [channel, type] of [
  ['papers:backpack:detach-stop-request', 'papers:project:detach-stop-request'],
  ['papers:backpack:detach-activate', 'papers:project:detach-activate'],
  ['papers:backpack:detach-flush-request', 'papers:project:detach-flush-request'],
  ['papers:backpack:detach-closed', 'papers:project:detach-closed'],
] as const) {
  ipcRenderer.on(channel, (_event, payload) => window.postMessage({ type, ...(payload ?? {}) }, window.location.origin));
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data as ProjectMessage;
  if (!request || typeof request.type !== 'string') return;
  if (request.type === 'papers:project:detach-flush-ack') {
    if (!detachedToken || !detachedTransferId || request.transferId !== detachedTransferId) {
      immediateHostError(request.requestId, event.origin, 'detached flush acknowledgement is malformed');
      return;
    }
    ipcRenderer.send('papers:backpack:detach-flush-ack', {
      token: detachedToken,
      transferId: detachedTransferId,
    });
    immediateHostResult(request.requestId, event.origin);
  }
  if (request.type === 'papers:project:detach-activated-ack') {
    if (!detachedToken || !detachedTransferId || !exactKeys(request as Record<string, unknown>, ['type', 'requestId', 'transferId'])
      || !validRequestId(request.requestId) || !validTransferId(request.transferId) || request.transferId !== detachedTransferId) {
      immediateHostError(request.requestId, event.origin, 'detached activation acknowledgement is malformed');
      return;
    }
    ipcRenderer.send('papers:backpack:detach-activated', {
      token: detachedToken,
      transferId: detachedTransferId,
    });
    immediateHostResult(request.requestId, event.origin);
  }
});
