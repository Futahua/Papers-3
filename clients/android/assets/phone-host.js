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
async function remoteFiles(params) {
  const ownerId = params.ownerId;
  switch (params.operation) {
    case 'status': { const result = await status(); return result; }
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
async function loadOwn() {
  const loaded = await native({ operation: 'local-state-load' });
  return { state: loaded.state ?? JSON.stringify(EMPTY_STATE), revision: loaded.revision };
}
async function handle(type, request) {
  switch (type) {
    case 'papers:project:state-load-versioned': return loadOwn();
    case 'papers:project:as-you-go-load': return { state: (await loadOwn()).state };
    case 'papers:project:state-save-checked': return { stateSave: await native({ operation: 'local-state-save', state: request.state, revision: request.revision }) };
    case 'papers:project:as-you-go-save': { const current = await loadOwn(); await native({ operation: 'local-state-save', state: request.state, revision: current.revision }); return {}; }
    case 'papers:project:workspace-writer-lease-acquire': return { writerLease: null };
    case 'papers:project:workspace-writer-lease-release': return {};
    case 'papers:project:file-capability': return { fileCapability: await fileCapability(request.operation, request.params || {}).catch((error) => ({ ok: false, code: 'FILE_OPERATION_FAILED', message: error.message })) };
    case 'papers:project:open-new-surface': {
      // A device's As you Go replaces the frame; Android back returns to the phone's own.
      const next = new URL(request.url);
      frame.src = next.pathname.replace(/^\//, '') + next.search;
      return {};
    }
    default: throw new Error('Not available on the phone.');
  }
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
  frame.src = 'proxima/index.html?papers-phone=1&papers-device=' + ownerId;
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
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  if (event.data?.type === 'papers:phone:proxima' || event.data?.type === 'papers:proxima-device:open') { void openProxima(event.data.ownerId).catch((error) => console.error(error)); return; }
  if (event.data?.type === 'papers:proxima-device:request') {
    const { requestId } = event.data;
    proximaRequest(event.data).then(
      (result) => frame.contentWindow.postMessage({ type: 'papers:proxima-device:result', requestId, ok: true, result }, location.origin),
      (error) => frame.contentWindow.postMessage({ type: 'papers:proxima-device:result', requestId, ok: false, error: String(error?.message || error) }, location.origin),
    );
    return;
  }
  if (typeof event.data?.type !== 'string' || !event.data.requestId) return;
  const { type, requestId } = event.data;
  handle(type, event.data).then(
    (payload) => frame.contentWindow.postMessage({ type: 'papers:host:result', requestId, ok: true, ...(payload || {}) }, location.origin),
    (error) => frame.contentWindow.postMessage({ type: 'papers:host:result', requestId, ok: false, error: String(error?.message || error) }, location.origin),
  );
});
// Android back: close an open preview first, then leave a device's As you Go.
window.papersBack = () => {
  const page = frame.contentWindow;
  if (page?.papersPhoneBack?.()) return true;
  if (frame.src.includes('papers-device=') || frame.src.includes('/proxima/')) { frame.src = 'ayg/workspace-20260730b.html?papers-phone=1'; return true; }
  return false;
};
frame.src = 'ayg/workspace-20260730b.html?papers-phone=1';
