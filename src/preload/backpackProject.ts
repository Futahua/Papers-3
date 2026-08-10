import { ipcRenderer, webUtils } from 'electron';

interface ProjectMessage { type?: unknown; requestId?: unknown; actionId?: unknown; text?: unknown; state?: unknown; url?: unknown; files?: unknown; kind?: unknown; candidateId?: unknown; capability?: unknown; bounds?: unknown; descriptor?: unknown; members?: unknown; }

const WINDOW_CAPABILITY_MAX_STRING_BYTES = 512;
const WINDOW_CAPABILITY_MAX_BOUNDS = 32768;

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

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data as ProjectMessage;
  if (!request || typeof request.type !== 'string') return;
  if (request.type === 'papers:project:close') { ipcRenderer.send('host:backpack-project:request-close'); return; }

  let task: Promise<unknown> | null = null;
  if (request.type === 'papers:project:run-action' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:run-action', request.actionId);
  if (request.type === 'papers:project:copy-text' && typeof request.text === 'string') task = ipcRenderer.invoke('host:backpack-project:copy-text', request.text);
  if (request.type === 'papers:project:as-you-go-load') task = ipcRenderer.invoke('host:backpack-project:state-load').then((state) => ({ state: JSON.stringify(state) }));
  if (request.type === 'papers:project:as-you-go-save' && typeof request.state === 'string') task = ipcRenderer.invoke('host:backpack-project:state-save', request.state);
  if (request.type === 'papers:project:as-you-go-pick-target' && (request.kind === 'file' || request.kind === 'folder')) task = ipcRenderer.invoke('host:backpack-project:pick-target', request.kind).then((selection) => ({ target: selection?.target ?? null, icon: selection?.icon ?? null }));
  if (request.type === 'papers:project:as-you-go-shortcut-icon' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:shortcut-icon', request.actionId).then((icon) => ({ icon }));
  if (request.type === 'papers:project:as-you-go-launch' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:launch-shortcut', request.actionId);
  if (request.type === 'papers:project:as-you-go-reveal' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:reveal-shortcut', request.actionId);
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
  if (request.type === 'papers:project:window-apply-capability') {
    const capability = parseCapability(request.capability);
    const bounds = parseBounds(request.bounds);
    task = ipcRenderer.invoke('papers:window-capability:apply', { capability, bounds });
  }
  if (request.type === 'papers:project:window-resolve-descriptor') {
    const descriptor = parseDescriptor(request.descriptor);
    task = ipcRenderer.invoke('papers:window-capability:resolve', descriptor);
  }
  if (request.type === 'papers:project:window-pick-begin') {
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
  if (!task) return;
  void task.then((payload) => window.postMessage({ type: 'papers:host:result', requestId: request.requestId, ok: true, ...(payload && typeof payload === 'object' ? payload : {}) }, event.origin))
    .catch((caught) => window.postMessage({ type: 'papers:host:result', requestId: request.requestId, ok: false, error: String(caught instanceof Error ? caught.message : caught) }, event.origin));
});

// The direct-pick session pushes its typed result to the project frame.
ipcRenderer.on('papers:window-pick:result', (_event, result) => {
  window.postMessage({ type: 'papers:project:window-pick-result', result }, window.location.origin);
});
