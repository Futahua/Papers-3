import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { resolveWindowsCscPath } from '../windows/foregroundBridge';

export interface PaneRect { x: number; y: number; width: number; height: number; rightInset?: number; bottomInset?: number }
export interface PaneContext { ownerKey: string; parentHwnd: string; paneGroup?: string; surfaceBounds: PaneRect }
export interface NativePaneSnapshot {
  binding: string; bindingGeneration: number; stateRevision: number; geometryRevision: number;
  nativeEdgeRevision?: number;
  viewport: PaneRect; tree: unknown; presented: boolean;
  groups: Array<{ id: string; selected: string | null; presentation: string; slot: PaneRect; content: PaneRect;
    tabs: Array<{ id: string; kind: 'native' | 'document'; active: boolean; title?: string; handle?: number; pid?: number; windowInstanceId?: string }> }>;
}
export interface PaneReply extends Record<string, unknown> { ok: boolean; error?: string; code?: string; snapshot?: NativePaneSnapshot; tabId?: string }
interface Scope { key: string; token: string; context: PaneContext; rect: PaneRect; host: Host; snapshot?: NativePaneSnapshot }
interface Host { child: ChildProcessWithoutNullStreams; queue: Promise<unknown>; stopped: boolean;
  pending: Map<string, { resolve: (reply: PaneReply) => void; timer: ReturnType<typeof setTimeout> }> }
export interface NativePaneBridge {
  has(owner: string): boolean;
  mount(context: PaneContext, rect: PaneRect, headerHeight: number): Promise<PaneReply>;
  command(owner: string, op: string, params?: Record<string, unknown>, revision?: number): Promise<PaneReply>;
  attach(owner: string, handle: number, pid: number, groupId?: string, retainedId?: string): Promise<PaneReply>;
  open(owner: string, source: string, url: string, groupId?: string): Promise<PaneReply>;
  move(owner: string, rect: PaneRect): Promise<PaneReply>;
  snapshot(owner: string): NativePaneSnapshot | undefined;
  setOwnerVisible(owner: string, visible: boolean): void;
  setOwnerSurfaceBounds(owner: string, bounds: PaneRect): void;
  closeOwner(owner: string): Promise<void>;
  dispose(): Promise<void>;
}
const unavailable = (): PaneReply => ({ ok: false, error: 'Window layout is not mounted.' });
const commandNames = new Set(['snapshot', 'raise', 'select', 'reorder', 'move', 'split', 'close-group', 'presentation', 'detach', 'document-add', 'document-remove', 'document-edge', 'present']);
export function createNativePaneBridge(input: { cacheDirectory: string; nativeDirectory: string; onSnapshot?: (owner: string, snapshot: NativePaneSnapshot) => void; windowInstanceId?: (handle: number, pid: number) => string | undefined }): NativePaneBridge | null {
  if (process.platform !== 'win32') return null;
  const compiler = resolveWindowsCscPath(process.env['WINDIR'] ?? 'C:\\Windows');
  if (!compiler) return null;
  const chrome = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter((p): p is string => Boolean(p))
    .map(p => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(p => fs.existsSync(p)) ?? '';
  const sources = ['chrome-window-session.cs', 'pane-group.cs', 'pane-layout.cs', 'pane-presentation.cs', 'pane-coordinator.cs', 'pane-coordinator-hub.cs',
    'pane-documents.cs', 'pane-mount.cs', 'pane-region-contract.cs', 'pane-host-region.cs', 'pane-chrome-resolver.cs', 'pane-coordinator-host.cs'].map(p => path.join(input.nativeDirectory, p));
  const hosts = new Map<string, Host>(), owners = new Map<string, Scope>(), scopes = new Map<string, Scope>(), visibility = new Map<string, boolean>();
  function localSnapshot(scope: Scope, snapshot: NativePaneSnapshot): NativePaneSnapshot {
    const offset = scope.context.surfaceBounds;
    const local = (rect: PaneRect): PaneRect => ({ ...rect, x: rect.x - offset.x, y: rect.y - offset.y });
    return { ...snapshot, viewport: local(snapshot.viewport), groups: snapshot.groups.map(g => ({ ...g, slot: local(g.slot), content: local(g.content), tabs: g.tabs.map(tab => {
      const { handle, pid, ...safe } = tab; return { ...safe, windowInstanceId: handle && pid ? input.windowInstanceId?.(handle, pid) : undefined };
    }) })) };
  }
  // The logical Papers window survives HWND replacement and surface remounts.
  function scopeKey(context: PaneContext): string { return createHash('sha256').update(`${context.ownerKey.split(':')[0]}:${context.paneGroup ?? 'workspace'}`).digest('hex'); }
  function binary(): string {
    const hash = createHash('sha256'); for (const source of sources) hash.update(fs.readFileSync(source));
    const executable = path.join(input.cacheDirectory, `pane-coordinator-${hash.digest('hex').slice(0, 16)}.exe`);
    if (fs.existsSync(executable)) return executable;
    fs.mkdirSync(input.cacheDirectory, { recursive: true });
    const wpf = path.join(path.dirname(compiler!), 'WPF');
    execFileSync(compiler!, ['/nologo', '/target:exe', `/out:${executable}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
      ...['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'].map(p => `/r:${path.join(wpf, p)}`), ...sources], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
    return executable;
  }
  function accept(scope: Scope, snapshot?: NativePaneSnapshot): void {
    if (!snapshot || snapshot.binding !== scope.token) return;
    const previous = scope.snapshot;
    if (previous && (snapshot.bindingGeneration < previous.bindingGeneration || snapshot.stateRevision < previous.stateRevision || snapshot.geometryRevision < previous.geometryRevision)) return;
    scope.snapshot = snapshot;
    if ((snapshot.nativeEdgeRevision ?? 0) > (previous?.nativeEdgeRevision ?? 0)) {
      const viewport = localSnapshot(scope, snapshot).viewport;
      scope.rect = { ...scope.rect, ...viewport };
    }
    if (visibility.get(scope.context.ownerKey) !== false && owners.get(scope.context.ownerKey) === scope)
      input.onSnapshot?.(scope.context.ownerKey, localSnapshot(scope, snapshot));
  }
  function host(context: PaneContext): Host {
    const existing = hosts.get(context.parentHwnd); if (existing && !existing.stopped) return existing;
    const child = spawn(binary(), [context.parentHwnd, String(process.pid), input.cacheDirectory, chrome], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const live: Host = { child, pending: new Map(), queue: Promise.resolve(), stopped: false }; hosts.set(context.parentHwnd, live);
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const data = JSON.parse(line) as { kind?: string; scope?: string; snapshot?: NativePaneSnapshot; id?: string; result?: PaneReply };
        if (data.kind === 'snapshot' && data.scope) { const scope = scopes.get(data.scope); if (scope?.host === live) accept(scope, data.snapshot); return; }
        const request = data.id ? live.pending.get(data.id) : undefined;
        if (request) { clearTimeout(request.timer); live.pending.delete(data.id!); request.resolve(data.result ?? unavailable()); }
      } catch { /* malformed output cannot mutate retained state */ }
    });
    const retire = (): void => {
      live.stopped = true; if (hosts.get(context.parentHwnd) === live) hosts.delete(context.parentHwnd);
      for (const request of live.pending.values()) { clearTimeout(request.timer); request.resolve({ ok: false, error: 'Native window coordinator stopped; its guard restores attached applications.' }); }
      live.pending.clear();
      for (const [key, scope] of scopes) if (scope.host === live) { scopes.delete(key); for (const [owner, value] of owners) if (value === scope) owners.delete(owner); }
    };
    child.on('exit', retire); child.on('error', retire); child.stderr.on('data', () => {}); return live;
  }
  function send(live: Host, data: Record<string, unknown>): Promise<PaneReply> {
    if (live.stopped) return Promise.resolve(unavailable());
    return new Promise(resolve => {
      const id = randomUUID();
      const timer = setTimeout(() => { live.pending.delete(id); resolve({ ok: false, error: 'Native window command timed out.' }); }, 16000);
      live.pending.set(id, { resolve, timer });
      live.child.stdin.write(JSON.stringify({ ...data, id }) + '\n', error => { if (error) { clearTimeout(timer); live.pending.delete(id); resolve({ ok: false, error: error.message }); } });
    });
  }
  function queued(scope: Scope, op: string, params: Record<string, unknown> = {}, revision?: number): Promise<PaneReply> {
    const token = scope.token, owner = scope.context.ownerKey;
    const task = scope.host.queue.then(async () => {
      if (scope.token !== token || owners.get(owner) !== scope || (visibility.get(owner) === false && !['present', 'release'].includes(op))) return unavailable();
      const result = await send(scope.host, { ...params, op, scope: scope.key, binding: token, revision: revision ?? scope.snapshot?.stateRevision ?? 0 });
      accept(scope, result.snapshot); return result.snapshot ? { ...result, snapshot: localSnapshot(scope, result.snapshot) } : result;
    });
    scope.host.queue = task.catch(() => undefined); return task;
  }
  const absolute = (scope: Scope, rect: PaneRect): PaneRect => ({ ...rect, x: scope.context.surfaceBounds.x + rect.x, y: scope.context.surfaceBounds.y + rect.y });
  const api: NativePaneBridge = {
    has: owner => owners.has(owner),
    async mount(context, rect, headerHeight) {
      if (visibility.get(context.ownerKey) === false) return unavailable();
      try {
        const key = scopeKey(context), previous = scopes.get(key);
        const scope: Scope = previous && previous.host === hosts.get(context.parentHwnd) && !previous.host.stopped ? previous : { key, token: randomUUID(), context, rect, host: host(context) };
        // Each remount gets a fresh token. Old surfaces cannot act through the new binding.
        scope.token = randomUUID(); scope.context = context; scope.rect = rect; scope.snapshot = undefined;
        for (const [owner, value] of owners) if (value === scope) owners.delete(owner);
        scopes.set(key, scope); owners.set(context.ownerKey, scope);
        const legacySurface = 'window:' + context.ownerKey.split(':')[0] + (context.paneGroup ? ':backpack:' + context.paneGroup : '');
        const legacyMount = path.join(input.cacheDirectory, 'chrome-link-tabs-' + createHash('sha256').update(legacySurface).digest('hex').slice(0, 16) + '.json.windows.json');
        const result = await queued(scope, 'mount', { rect: absolute(scope, rect), headerHeight, legacyMount });
        if (!result.ok && owners.get(context.ownerKey) === scope) { owners.delete(context.ownerKey); if (scopes.get(key) === scope) scopes.delete(key); }
        return result;
      } catch (error) { return { ok: false, error: String(error) }; }
    },
    command(owner, op, params = {}, revision) { const scope = owners.get(owner); return scope && commandNames.has(op) ? queued(scope, op, params, revision) : Promise.resolve(unavailable()); },
    attach(owner, handle, pid, groupId = 'main', retainedId) { const scope = owners.get(owner); return scope ? queued(scope, 'attach', { handle, pid, groupId, ...(retainedId ? { retainedId } : {}) }) : Promise.resolve(unavailable()); },
    open(owner, source, url, groupId) { const scope = owners.get(owner); return scope ? queued(scope, 'open', { source, url, ...(groupId ? { groupId } : {}) }) : Promise.resolve(unavailable()); },
    async move(owner, rect) { const scope = owners.get(owner); if (!scope) return unavailable();
      const result = await queued(scope, 'viewport', { rect: absolute(scope, rect) });
      if (result.ok) scope.rect = { ...rect, ...result.snapshot?.viewport };
      return result;
    },
    snapshot(owner) { return owners.get(owner)?.snapshot; },
    setOwnerVisible(owner, visible) { visibility.set(owner, visible); const scope = owners.get(owner); if (scope) void queued(scope, 'present', { visible }); },
    setOwnerSurfaceBounds(owner, bounds) { const scope = owners.get(owner); if (scope) { scope.context = { ...scope.context, surfaceBounds: bounds }; void api.move(owner, scope.rect); } },
    async closeOwner(owner) { const scope = owners.get(owner); if (!scope) return;
      await queued(scope, 'release'); if (owners.get(owner) === scope) owners.delete(owner); if (scopes.get(scope.key) === scope) scopes.delete(scope.key); visibility.delete(owner);
    },
    async dispose() { const all = [...hosts.values()]; await Promise.all(all.map(async live => { await live.queue.catch(() => undefined); await send(live, { op: 'release-host' }); live.child.stdin.end(); })); owners.clear(); scopes.clear(); hosts.clear(); },
  };
  return api;
}
