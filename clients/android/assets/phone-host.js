// Runs As you Go (the same page as on Windows) in a frame and answers its host requests on
// the phone. The phone's own As you Go lives in the app; another device's drives appear as
// \\papers~<deviceId>\D:\... paths, served by the paired computer through MobileFiles.
let sequence = 0;
const replies = new Map();
window.papersReply = (id, result) => { const pending = replies.get(id); if (!pending) return; replies.delete(id); pending(result); };
const native = (params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  replies.set(id, (result) => result?.ok ? resolve(result.result) : reject(new Error(result?.message || 'Operation failed.')));
  window.PapersNative.request(String(id), JSON.stringify(params));
});

const frame = document.querySelector('#ayg');
const EMPTY_STATE = { schemaVersion: 1, groups: [], shortcuts: [] };
const PATTERN = /^\\\\papers~([a-f0-9-]{36})(?:\\(.*))?$/i;
const parse = (value) => { const m = typeof value === 'string' ? PATTERN.exec(value.replace(/\//g, '\\').replace(/\\+$/, '')) : null; return m ? { ownerId: m[1].toLowerCase(), parts: (m[2] || '').split('\\').filter(Boolean) } : null; };
const remotePath = (ownerId, parts) => [`\\\\papers~${ownerId}`, ...parts].join('\\');
const listings = new Map();
let devices = [];
async function status() { const result = await native({ operation: 'status' }); devices = result.devices || []; return result; }
async function listAll(ownerId, id = '') {
  const key = ownerId + '|' + id, cached = listings.get(key);
  if (cached && Date.now() - cached.at < 2000) return cached.entries;
  const entries = []; let offset = 0;
  while (offset !== null) { const page = await native({ operation: 'browse', ownerId, resourceId: id, offset }); entries.push(...page.entries); offset = page.nextOffset ?? null; }
  listings.set(key, { at: Date.now(), entries });
  return entries;
}
const forget = (ownerId) => { for (const key of [...listings.keys()]) if (key.startsWith(ownerId + '|')) listings.delete(key); };
async function resolve(target) {
  const parsed = parse(target);
  if (!parsed) throw new Error('This phone has no local drives.');
  if (!devices.some((d) => d.id === parsed.ownerId)) await status();
  let entry = null;
  for (const part of parsed.parts) {
    const entries = await listAll(parsed.ownerId, entry?.id);
    entry = entries.find((item) => item.name === part) ?? entries.find((item) => item.name.toLowerCase() === part.toLowerCase());
    if (!entry) throw new Error('That item is no longer on the device.');
  }
  return { ...parsed, entry };
}
const deviceName = (ownerId) => devices.find((d) => d.id === ownerId)?.name ?? 'Device';
function describe(ownerId, parts, entry) {
  const kind = entry?.kind ?? 'folder', name = entry ? entry.name : deviceName(ownerId);
  const dot = kind === 'file' ? name.lastIndexOf('.') : -1;
  return { path: remotePath(ownerId, parts), name, parent: remotePath(ownerId, parts.slice(0, -1)), kind, extension: dot > 0 ? name.slice(dot).toLowerCase() : '', size: kind === 'file' ? entry.size : null, createdAt: null, modifiedAt: entry ? Math.round(entry.modifiedAt) : null, identity: entry ? `${ownerId}:${entry.id}` : ownerId, remote: { ownerId, device: deviceName(ownerId) } };
}
async function command(ownerId, body) {
  const commandId = crypto.randomUUID();
  await native({ operation: 'change', ownerId, command: { commandId, ...body } });
  for (let i = 0; i < 600; i++) {
    const job = (await native({ operation: 'changes', ownerId })).find((item) => item.commandId === commandId);
    if (job && ['completed', 'failed', 'uncertain'].includes(job.phase)) { forget(ownerId); if (job.phase !== 'completed') throw new Error(job.error || 'The device reported ' + job.phase + '.'); return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The device did not confirm the change.');
}
const inboxKey = (ownerId) => 'papers-phone-inbox:' + ownerId;

async function fileCapability(operation, params) {
  if (operation === 'remote-files') return { ok: true, result: await remoteFiles(params) };
  const paths = Array.isArray(params.paths) ? params.paths : [];
  if (operation === 'search') {
    const scope = parse(params.path);
    if (!scope) return { ok: false, code: 'EVERYTHING_UNAVAILABLE', message: 'Search runs on a device. Open one from Devices first.', results: [] };
    const found = await native({ operation: 'search', ownerId: scope.ownerId, query: String(params.query || ''), limit: params.limit || 100 });
    const results = found.map((item) => ({ path: remotePath(scope.ownerId, item.parts), name: item.name, kind: item.kind, size: item.size, modifiedAt: item.modifiedAt, attributes: 0 }));
    return { ok: true, provider: 'everything', version: null, total: results.length, results };
  }
  if (operation === 'providers') return { ok: true, providers: { everything: true } };
  // The phone's own files (chosen with the paperclip) live at \\papers~phone\<content address>.
  const own = phoneUri(params.path);
  if (own) return phoneFile(operation, own, params.path);
  if (![params.path, params.destination, ...paths].some(parse)) return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available on the phone.' };
  switch (operation) {
    case 'stat': { const { ownerId, parts, entry } = await resolve(params.path); return { ok: true, entry: describe(ownerId, parts, entry) }; }
    case 'list': {
      const { ownerId, parts, entry } = await resolve(params.path);
      const items = (await listAll(ownerId, entry?.id)).map((item) => describe(ownerId, [...parts, item.name], item))
        .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      return { ok: true, entry: describe(ownerId, parts, entry), items, truncated: false };
    }
    case 'icon': return { ok: true, icon: null };
    case 'preview': {
      // The computer that holds the file renders the preview with its own tools.
      const { ownerId, parts, entry } = await resolve(params.path);
      if (!entry || entry.kind !== 'file') return { ok: true, entry: describe(ownerId, parts, entry), preview: { kind: 'none' } };
      return { ok: true, entry: describe(ownerId, parts, entry), preview: await native({ operation: 'preview', ownerId, resourceId: entry.id }) };
    }
    case 'create-folder': { const { ownerId, entry } = await resolve(params.path); await command(ownerId, { operation: 'create-folder', resourceId: entry.id, expectedVersion: entry.version, newName: String(params.newName) }); return fileCapability('stat', { path: `${params.path}\\${params.newName}` }); }
    case 'rename': { const { ownerId, parts, entry } = await resolve(params.path); await command(ownerId, { operation: 'rename', resourceId: entry.id, expectedVersion: entry.version, newName: String(params.newName) }); return { ok: true, operation, path: remotePath(ownerId, [...parts.slice(0, -1), String(params.newName)]) }; }
    case 'delete': { for (const target of paths) { const { ownerId, entry } = await resolve(target); await command(ownerId, { operation: 'delete', resourceId: entry.id, expectedVersion: entry.version }); } return { ok: true, operation }; }
    case 'copy': case 'move': {
      const owners = new Set([...paths, params.destination].map((p) => parse(p)?.ownerId ?? 'phone'));
      if (owners.size !== 1 || owners.has('phone')) return { ok: false, code: 'CROSS_DEVICE_UNSUPPORTED', message: 'From the phone, copy and move work within one device.' };
      const ownerId = [...owners][0];
      for (const target of paths) { const { entry } = await resolve(target); const destination = (await resolve(params.destination)).entry; await command(ownerId, { operation, resourceId: entry.id, expectedVersion: entry.version, destinationId: destination.id, destinationVersion: destination.version }); }
      return { ok: true, operation };
    }
    default: return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available on the phone.' };
  }
}
// A path shaped like any other (so As you Go previews it), holding the phone file's content:// address.
const PHONE_ROOT = '\\\\papers~phone\\';
const phoneUri = (path) => {
  const text = String(path || '');
  if (!text.toLowerCase().startsWith(PHONE_ROOT)) return null;
  try { const uri = decodeURIComponent(text.slice(PHONE_ROOT.length)); return uri.startsWith('content://') ? uri : null; } catch { return null; }
};
async function phoneFile(operation, uri, path) {
  const entry = async () => {
    const info = await native({ operation: 'uri-stat', uri });
    const dot = info.name.lastIndexOf('.');
    return { path, name: info.name, parent: null, kind: 'file', extension: dot > 0 ? info.name.slice(dot).toLowerCase() : '', size: info.size ?? null, createdAt: null, modifiedAt: null, identity: null };
  };
  switch (operation) {
    case 'stat': return { ok: true, entry: await entry() };
    case 'preview': return { ok: true, entry: await entry(), preview: await native({ operation: 'uri-preview', uri }) };
    case 'open': return { ok: true, ...(await native({ operation: 'uri-open', uri })) };
    case 'icon': return { ok: true, icon: null };
    default: return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available for a phone file.' };
  }
}
let selfName = null;
async function phoneName() { if (!selfName) selfName = (await native({ operation: 'self' })).name; return selfName; }
async function remoteFiles(params) {
  const ownerId = params.ownerId;
  switch (params.operation) {
    case 'status': { const result = await status(); return { ...result, owner: { name: await phoneName() } }; }
    case 'workspaces': return native({ operation: 'workspaces', ownerId });
    case 'workspace-load': return native({ operation: 'workspace-load', ownerId, workspaceId: params.workspaceId });
    case 'workspace-icon': return native({ operation: 'workspace-icon', ownerId, workspaceId: params.workspaceId, name: params.name });
    case 'workspace-save': return native({ operation: 'workspace-save', ownerId, workspaceId: params.workspaceId, state: params.state, revision: params.revision });
    case 'inbox': {
      let chosen = null; try { chosen = JSON.parse(localStorage.getItem(inboxKey(ownerId)) || 'null'); } catch {}
      if (chosen) return { path: remotePath(ownerId, chosen), parts: chosen, chosen: true };
      const fallback = await native({ operation: 'inbox', ownerId });
      return { path: remotePath(ownerId, fallback.parts), parts: fallback.parts, chosen: false };
    }
    case 'inbox-set': {
      const text = typeof params.path === 'string' ? params.path.trim() : '';
      if (!text) { try { localStorage.removeItem(inboxKey(ownerId)); } catch {} return remoteFiles({ operation: 'inbox', ownerId }); }
      const parts = text.replace(/\//g, '\\').split('\\').filter(Boolean);
      if (!/^[A-Za-z]:$/.test(parts[0] || '')) throw new Error('Type a folder path on that device, like C:\\Users\\me\\Inbox.');
      parts[0] = parts[0].toUpperCase();
      try { localStorage.setItem(inboxKey(ownerId), JSON.stringify(parts)); } catch {}
      return { path: remotePath(ownerId, parts), parts, chosen: true };
    }
    default: throw new Error('Not available on the phone.');
  }
}

// The phone's own As you Go document.
// A phone document without a theme of its own takes the theme of the computers' As you Go.
const THEME_KEY = 'papers-phone-computer-theme';
async function computerTheme() {
  let theme = null; try { theme = localStorage.getItem(THEME_KEY); } catch {}
  if (theme) return theme;
  try {
    for (const device of (await status()).devices || []) {
      const [workspace] = await native({ operation: 'workspaces', ownerId: device.id });
      if (!workspace) continue;
      const loaded = await native({ operation: 'workspace-load', ownerId: device.id, workspaceId: workspace.id });
      theme = loaded.state?.view?.preferences?.theme;
      if (theme) break;
    }
  } catch {}
  theme ||= 'dark';
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  return theme;
}
async function loadOwn() {
  const loaded = await native({ operation: 'local-state-load' });
  const state = loaded.state ? JSON.parse(loaded.state) : structuredClone(EMPTY_STATE);
  if (!state.view?.preferences?.theme) state.view = { ...(state.view || {}), preferences: { ...(state.view?.preferences || {}), theme: await computerTheme() } };
  return { state: JSON.stringify(state), revision: loaded.revision };
}
async function handle(type, request) {
  switch (type) {
    case 'papers:project:state-load-versioned': return loadOwn();
    case 'papers:project:as-you-go-load': return { state: (await loadOwn()).state };
    case 'papers:project:state-save-checked': return { stateSave: await native({ operation: 'local-state-save', state: request.state, revision: request.revision }) };
    case 'papers:project:as-you-go-save': { const current = await loadOwn(); await native({ operation: 'local-state-save', state: request.state, revision: current.revision }); return {}; }
    case 'papers:project:workspace-writer-lease-acquire': return { writerLease: null };
    case 'papers:project:workspace-writer-lease-release': return {};
    case 'papers:phone:pick-files': return { picked: (await native({ operation: 'pick-files' })).map((file) => ({ ...file, target: PHONE_ROOT + encodeURIComponent(file.target) })) };
    case 'papers:project:file-capability': return { fileCapability: await fileCapability(request.operation, request.params || {}).catch((error) => ({ ok: false, code: 'FILE_OPERATION_FAILED', message: error.message })) };
    case 'papers:project:open-new-surface': {
      // A device's As you Go opens over the phone's own; Android back returns to it.
      const next = new URL(request.url);
      openLayer(next.pathname.replace(/^\//, '') + next.search);
      return {};
    }
    default: throw new Error('Not available on the phone.');
  }
}
// The phone's own As you Go stays loaded; Proxima and a device's As you Go open in a layer over it
// that appears only once painted in its theme, and back just removes the layer (no reload, no flash).
let layer = null;
// The open layer is remembered, so the app comes back where it was left.
const LAST_LAYER = 'papers-phone-last-layer';
function openLayer(src) {
  const previous = layer;
  const next = document.createElement('iframe');
  next.className = 'papers-layer'; next.title = 'Papers'; next.style.visibility = 'hidden';
  next.src = src; document.body.append(next); layer = next;
  try { localStorage.setItem(LAST_LAYER, src); } catch {}
  const started = Date.now();
  const reveal = () => {
    if (layer !== next) return;
    const root = next.contentDocument?.documentElement;
    // As you Go marks its theme once its document is installed; Proxima says when it has drawn the
    // device's own data (never its default layout first), and slides in.
    const proxima = src.startsWith('proxima/');
    const ready = root && next.contentDocument.readyState === 'complete' && (proxima ? next.dataset.ready === 'true' : root.dataset.theme);
    if (next.style.visibility === 'visible') return;
    if (ready || Date.now() - started > (proxima ? 16000 : 6000)) {
      if (proxima) next.classList.add('is-entering');
      next.style.visibility = 'visible';
      // The previous layer stays under the incoming one until its slide-in has finished.
      if (previous) setTimeout(() => previous.remove(), proxima ? 260 : 0);
    } else setTimeout(reveal, 50);
  };
  next.addEventListener('load', reveal);
  // Proxima gets the phone's own gestures (swipe inertia, cursor mode) on top of its touch layer.
  if (src.startsWith('proxima/')) next.addEventListener('load', () => {
    const script = next.contentDocument.createElement('script');
    script.src = new URL('proxima-phone.js', location.href).href;
    next.contentDocument.head.append(script);
  });
}
function closeLayer() {
  if (!layer) return false;
  // Proxima fades out over As you Go; other layers just go.
  for (const node of document.querySelectorAll('.papers-layer')) {
    if (node.getAttribute('src')?.startsWith('proxima/') && node.style.visibility === 'visible') { node.classList.add('is-leaving'); setTimeout(() => node.remove(), 200); }
    else node.remove();
  }
  layer = null; try { localStorage.removeItem(LAST_LAYER); } catch {} return true;
}
// Proxima on the phone shows another machine's Proxima: the last one viewed, else the first with one.
const PROXIMA_DEVICE = 'papers-phone-proxima-device';
async function proximaShare(ownerId) {
  const list = await native({ operation: 'backpacks', ownerId });
  const share = (list.entries || []).find((item) => item.kind === 'proxima');
  if (!share) throw new Error('That computer has no Proxima to show.');
  return share;
}
async function openProxima(ownerId) {
  if (!ownerId) {
    let remembered = null; try { remembered = localStorage.getItem(PROXIMA_DEVICE); } catch {}
    const known = (await status()).devices || [];
    ownerId = known.some((d) => d.id === remembered) ? remembered : known[0]?.id;
  }
  if (!ownerId) throw new Error('No computer is connected.');
  try { localStorage.setItem(PROXIMA_DEVICE, ownerId); } catch {}
  openLayer('proxima/index.html?papers-phone=1&papers-device=' + ownerId);
}
async function proximaRequest(request) {
  if (request.operation === 'devices') return (await status()).devices || [];
  if (request.operation === 'snapshot') {
    const share = await proximaShare(request.ownerId);
    const result = await native({ operation: 'backpack-snapshot', ownerId: request.ownerId, resourceId: share.id });
    return { snapshot: result.snapshot, online: result.online, name: deviceName(request.ownerId) };
  }
  throw new Error('Not available on the phone.');
}
const fromPage = (source) => source === frame.contentWindow || (layer && source === layer.contentWindow);
window.addEventListener('message', (event) => {
  if (!fromPage(event.source)) return;
  const reply = (message) => event.source.postMessage(message, location.origin);
  if (event.data?.type === 'papers:phone:proxima' || event.data?.type === 'papers:proxima-device:open') { void openProxima(event.data.ownerId).catch((error) => console.error(error)); return; }
  // "This device" in a device's As you Go returns to the phone's own.
  if (event.data?.type === 'papers:phone:this-device') { closeLayer(); return; }
  if (event.data?.type === 'proxima:device-view-ready') { if (layer && event.source === layer.contentWindow) layer.dataset.ready = 'true'; return; }
  if (event.data?.type === 'papers:proxima-device:request') {
    const { requestId } = event.data;
    proximaRequest(event.data).then(
      (result) => reply({ type: 'papers:proxima-device:result', requestId, ok: true, result }),
      (error) => reply({ type: 'papers:proxima-device:result', requestId, ok: false, error: String(error?.message || error) }),
    );
    return;
  }
  if (typeof event.data?.type !== 'string' || !event.data.requestId) return;
  const { type, requestId } = event.data;
  handle(type, event.data).then(
    (payload) => reply({ type: 'papers:host:result', requestId, ok: true, ...(payload || {}) }),
    (error) => reply({ type: 'papers:host:result', requestId, ok: false, error: String(error?.message || error) }),
  );
});
// Android back: close an open preview first, then the layer (Proxima or a device), then leave.
window.papersBack = () => {
  const page = (layer || frame).contentWindow;
  if (page?.papersPhoneBack?.()) return true;
  return closeLayer();
};
// The phone's As you Go shows only once painted in its theme (no white page at launch), and the
// screen that was open when the app was left opens again over it.
frame.src = 'ayg/workspace-20260730b.html?papers-phone=1';
{
  const started = Date.now();
  const reveal = () => {
    if (frame.contentDocument?.documentElement?.dataset.theme || Date.now() - started > 6000) frame.style.visibility = 'visible'; else setTimeout(reveal, 50);
  };
  reveal();
  let last = null; try { last = localStorage.getItem(LAST_LAYER); } catch {}
  if (last && /^(proxima|ayg)\//.test(last)) openLayer(last);
}
