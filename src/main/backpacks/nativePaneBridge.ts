import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { resolveWindowsCscPath } from '../windows/foregroundBridge';

export interface PaneRect { x: number; y: number; width: number; height: number; rightInset?: number; bottomInset?: number }
export interface PaneContext { ownerKey: string; parentHwnd: string; paneGroup?: string; layoutKey?: string; surfaceBounds: PaneRect }
export interface NativePaneSnapshot {
  binding: string; bindingGeneration: number; stateRevision: number; geometryRevision: number;
  nativeEdgeRevision?: number;
  moveRejected?: {id:string;groupId:string;tabId?:string};
  viewport: PaneRect; tree: unknown; presented: boolean;
  groups: Array<{ id: string; transferId?: string; selected: string | null; presentation: string; slot: PaneRect; content: PaneRect;
    tabs: Array<{ id: string; kind: 'native' | 'document' | 'dormant'; active: boolean; title?: string; handle?: number; pid?: number; windowInstanceId?: string; preview?: {Id?:string;Path?:string;Name?:string;PageKey?:string;TabStyle?:string} }> }>;
}
export interface PaneReply extends Record<string, unknown> { ok: boolean; error?: string; code?: string; snapshot?: NativePaneSnapshot; tabId?: string }
export interface PaneWindowOwnership { transferId: string; label: string; samePage: boolean }
interface Scope { key: string; token: string; context: PaneContext; rect: PaneRect; headerHeight: number; host: Host; snapshot?: NativePaneSnapshot; removedDocuments?: string[] }
interface Host { child: ChildProcessWithoutNullStreams; queue: Promise<unknown>; stopped: boolean;
  pending: Map<string, { resolve: (reply: PaneReply) => void; timer: ReturnType<typeof setTimeout> }> }
export interface NativePaneBridge {
  canFitWindow(windowId:number,deltaWidth:number,deltaHeight:number):Promise<boolean>;
  canFitPageGroup(windowId:number,surfaceIds:string[],width:number,height:number,includeHidden?:boolean):Promise<boolean>;
  has(owner: string): boolean;
  mount(context: PaneContext, rect: PaneRect, headerHeight: number): Promise<PaneReply>;
  command(owner: string, op: string, params?: Record<string, unknown>, revision?: number): Promise<PaneReply>;
  attach(owner: string, handle: number, pid: number, groupId?: string, retainedId?: string): Promise<PaneReply>;
  open(owner: string, source: string, url: string, groupId?: string): Promise<PaneReply>;
  move(owner: string, rect: PaneRect): Promise<PaneReply>;
  snapshot(owner: string): NativePaneSnapshot | undefined;
  ownership(instanceId: string, callerOwner?: string): PaneWindowOwnership | undefined;
  reveal(owner: string, transferId: string): Promise<PaneReply>;
  transfer(owner: string, transferId: string, groupId: string, side?: string): Promise<PaneReply>;
  transferCheck(owner:string,groupId:string,side:string):Promise<PaneReply>;
  dragOverlay(owner: string, active: boolean,transferId?:string,cancelled?:boolean): Promise<PaneReply>;
  setHostOverlayActive?(windowId: number, active: boolean): Promise<void>;
  setOwnerVisible(owner: string, visible: boolean): void;
  setOwnerSurfaceBounds(owner: string, bounds: PaneRect): void;
  closeOwner(owner: string): Promise<void>;
  dispose(): Promise<void>;
}
const unavailable = (): PaneReply => ({ ok: false, error: 'Window layout is not mounted.' });
const commandNames = new Set(['checkpoint', 'reconnect', 'resume', 'snapshot', 'raise', 'select', 'reorder', 'move', 'split', 'relocate-group', 'close-group', 'presentation', 'detach', 'document-add', 'document-remove', 'document-edge', 'ensure-panels', 'present', 'can-insert-group']);
export function createNativePaneBridge(input: { cacheDirectory: string; nativeDirectory: string; onSnapshot?: (owner: string, snapshot: NativePaneSnapshot) => void; windowInstanceId?: (handle: number, pid: number) => string | undefined;
  ownerLabel?: (owner: string) => string; revealOwner?: (owner: string) => Promise<void> }): NativePaneBridge | null {
  if (process.platform !== 'win32') return null;
  const compiler = resolveWindowsCscPath(process.env['WINDIR'] ?? 'C:\\Windows');
  if (!compiler) return null;
  const chrome = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter((p): p is string => Boolean(p))
    .map(p => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(p => fs.existsSync(p)) ?? '';
  const sources = ['chrome-window-session.cs', 'pane-group.cs', 'pane-layout.cs', 'pane-presentation.cs', 'pane-coordinator.cs', 'pane-coordinator-hub.cs',
    'pane-documents.cs', 'pane-mount.cs', 'pane-region-contract.cs', 'pane-host-region.cs', 'pane-chrome-resolver.cs', 'pane-coordinator-host.cs'].map(p => path.join(input.nativeDirectory, p));
  const hosts = new Map<string, Host>(), owners = new Map<string, Scope>(), scopes = new Map<string, Scope>(), visibility = new Map<string, boolean>();
  let disposing = false;
  const dragOwners = new Map<string,ReturnType<typeof setTimeout>>();
  let draggedTransfer:{owner:string;id:string}|undefined;
  let refusedDrag:string|undefined;
  const hostOverlays = new Set<number>();
  const hostOverlayActive = (owner: string): boolean => hostOverlays.has(Number(owner.split(':')[0]));
  let overlayTail: Promise<unknown> = Promise.resolve();
  const autoResumed = new Set<string>(); const locked = new Set<Scope>(); let transferTail: Promise<unknown> = Promise.resolve();
  const journalFile = path.join(input.cacheDirectory, 'pane-transfer-journal.json');
  const mountFile = (key: string): string => path.join(input.cacheDirectory, `pane-mount-${key}.json`);
  function durableWrite(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    const descriptor = fs.openSync(temp, 'w');
    try { fs.writeFileSync(descriptor, JSON.stringify(value)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temp, file);
  }
  function restoreCheckpoint(key: string, mount: any): void {
    durableWrite(mountFile(key),mount);
    durableWrite(path.join(path.dirname(input.cacheDirectory),'pane-layouts',`pane-mount-${key}.json`), {
      Version:1,HeaderHeight:mount.HeaderHeight,LeftOffset:mount.LeftOffset,ProtectedPanelsMigrated:mount.ProtectedPanelsMigrated,Root:mount.Root,Groups:mount.Groups,
      Peers:mount.Peers?.map((peer:any)=>({TabId:peer.TabId,GroupId:peer.GroupId,Title:peer.Title,Icon:peer.Icon,Url:peer.Url})),
      Documents:mount.Documents,DocumentReferences:mount.DocumentReferences,
    });
  }
  // A prepared handoff is compensated before any coordinator remounts. Guards
  // restore original application placements; these records restore membership.
  if (fs.existsSync(journalFile)) {
    const text = fs.readFileSync(journalFile, 'utf8');
    if (Buffer.byteLength(text) <= 16 * 1024 * 1024) {
      let journal: { status?: string; records?: Array<{ key: string; mount: unknown }> } | undefined;
      try { journal = JSON.parse(text); } catch { /* malformed journal is retained for inspection */ }
      if ((journal?.status === 'prepared' || journal?.status === 'committed') && journal.records?.length === 2 && journal.records.every(record => /^[a-f0-9]{64}$/.test(record.key))) {
        for (const record of journal.records) restoreCheckpoint(record.key, record.mount);
        durableWrite(journalFile, { ...journal, status: journal.status === 'prepared' ? 'rolled-back' : 'recovered-commit' });
      }
    }
  }
  function localSnapshot(scope: Scope, snapshot: NativePaneSnapshot): NativePaneSnapshot {
    const offset = scope.context.surfaceBounds;
    const local = (rect: PaneRect): PaneRect => ({ ...rect, x: rect.x - offset.x, y: rect.y - offset.y });
    return { ...snapshot, ...(scope.removedDocuments?.length ? {removedDocumentIds:scope.removedDocuments}:{}), viewport: local(snapshot.viewport), groups: snapshot.groups.map(g => ({ ...g, transferId: ticket(scope, 'group:' + g.id), slot: local(g.slot), content: local(g.content), tabs: g.tabs.map(tab => {
      const { handle, pid, ...safe } = tab; return { ...safe, transferId: ticket(scope, tab.id), windowInstanceId: handle && pid ? input.windowInstanceId?.(handle, pid) : undefined };
    }) })) };
  }
  // The logical Papers window survives HWND replacement and surface remounts.
  function scopeKey(context: PaneContext): string { return createHash('sha256').update(context.layoutKey ?? `${context.ownerKey.split(':')[0]}:${context.paneGroup ?? 'workspace'}`).digest('hex'); }
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
    if (!locked.has(scope) && visibility.get(scope.context.ownerKey) !== false && owners.get(scope.context.ownerKey) === scope)
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
  function queued(scope: Scope, op: string, params: Record<string, unknown> = {}, revision?: number, transaction = false): Promise<PaneReply> {
    const token = scope.token, owner = scope.context.ownerKey;
    const task = scope.host.queue.then(async () => {
      if (disposing && !transaction && op !== 'release') return unavailable();
      if (scope.token !== token || owners.get(owner) !== scope || (!transaction && (locked.has(scope) || visibility.get(owner) === false && !['present', 'release', 'document-remove'].includes(op)))) return unavailable();
      const presentationParams = (op === 'present' || op === 'mount') && params.visible === true && hostOverlayActive(owner) ? { ...params, visible: false } : params;
      const result = await send(scope.host, { ...presentationParams, op, scope: scope.key, binding: token, revision: revision ?? scope.snapshot?.stateRevision ?? 0 });
      accept(scope, result.snapshot); return result.snapshot ? { ...result, snapshot: localSnapshot(scope, result.snapshot) } : result;
    });
    scope.host.queue = task.catch(() => undefined); return task;
  }
  const absolute = (scope: Scope, rect: PaneRect): PaneRect => ({ ...rect, x: scope.context.surfaceBounds.x + rect.x, y: scope.context.surfaceBounds.y + rect.y });
  const ticket = (scope: Scope, tabId: string): string => createHash('sha256').update(`${scope.key}:${scope.token}:${tabId}`).digest('hex').slice(0, 32);
  function claimFor(id: string): { scope: Scope; groupId: string; tabId?: string } | undefined {
    for (const scope of owners.values()) for (const group of scope.snapshot?.groups ?? []) {
      if (ticket(scope, 'group:' + group.id) === id) return { scope, groupId: group.id };
      for (const tab of group.tabs) if (ticket(scope, tab.id) === id) return { scope, groupId: group.id, tabId: tab.id };
    }
    return undefined;
  }
  const protectedGroup=(scope:Scope,groupId:string):boolean=>Boolean(scope.snapshot?.groups.find(g=>g.id===groupId)?.tabs.some(t=>['preview:workspace-files','preview:workspace-preview'].includes(t.id)||Boolean(t.preview?.PageKey)));
  async function checkSwap(from:Scope,sourceGroup:string,target:Scope,targetGroup:string):Promise<PaneReply>{
    const before=[from,target].map(s=>[s.token,s.snapshot?.stateRevision,s.snapshot?.geometryRevision]);
    if(protectedGroup(from,sourceGroup)||protectedGroup(target,targetGroup))return {ok:false,error:'Files and Preview stay with their page.'};
    const a=await queued(from,'group-minimum',{groupId:sourceGroup},undefined,true);
    const b=await queued(target,'group-minimum',{groupId:targetGroup},undefined,true);
    if(!a.ok||!b.ok)return {ok:false,error:'The group changed during the drag.'};
    const left=await queued(from,'can-replace-group',{groupId:sourceGroup,width:b.width,height:b.height},undefined,true);
    const right=await queued(target,'can-replace-group',{groupId:targetGroup,width:a.width,height:a.height},undefined,true);
    if([from,target].some((s,i)=>JSON.stringify([s.token,s.snapshot?.stateRevision,s.snapshot?.geometryRevision])!==JSON.stringify(before[i])))return {ok:false,error:'The groups changed during the drag.'};
    return left.ok&&right.ok?{ok:true}:{ok:false,error:'The exchanged groups cannot fit both layouts.'};
  }
  const api: NativePaneBridge = {
    has: owner => owners.has(owner),
    async mount(context, rect, headerHeight) {
      await transferTail;
      try {
        const key = scopeKey(context), previous = scopes.get(key);
        // Claim the old window/Backpack checkpoint once. Further pages start
        // empty, and the first claimant keeps its durable page identity when
        // moved to another physical Papers window.
        if (context.layoutKey) {
          const oldKey = createHash('sha256').update(`${context.ownerKey.split(':')[0]}:${context.paneGroup ?? 'workspace'}`).digest('hex');
          const oldMount = path.join(input.cacheDirectory, `pane-mount-${oldKey}.json`);
          const target = path.join(input.cacheDirectory, `pane-mount-${key}.json`);
          const claim = oldMount + '.page-migration';
          if (!fs.existsSync(target) && fs.existsSync(oldMount)) {
            fs.mkdirSync(input.cacheDirectory, { recursive: true });
            try { fs.writeFileSync(claim, key, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            if (fs.readFileSync(claim, 'utf8') === key) fs.copyFileSync(oldMount, target, fs.constants.COPYFILE_EXCL);
          }
        }
        const scope: Scope = previous && previous.host === hosts.get(context.parentHwnd) && !previous.host.stopped ? previous : { key, token: randomUUID(), context, rect, headerHeight, host: host(context) };
        // Each remount gets a fresh token. Old surfaces cannot act through the new binding.
        scope.token = randomUUID(); scope.context = context; scope.rect = rect; scope.headerHeight = headerHeight; scope.snapshot = undefined;
        for (const [owner, value] of owners) if (value === scope) owners.delete(owner);
        scopes.set(key, scope); owners.set(context.ownerKey, scope);
        const legacySurface = 'window:' + context.ownerKey.split(':')[0] + (context.paneGroup ? ':backpack:' + context.paneGroup : '');
        const legacyMount = path.join(input.cacheDirectory, 'chrome-link-tabs-' + createHash('sha256').update(legacySurface).digest('hex').slice(0, 16) + '.json.windows.json');
        const result = await queued(scope, 'mount', { rect: absolute(scope, rect), headerHeight, legacyMount, visible:visibility.get(context.ownerKey)!==false&&dragOwners.size===0 },undefined,true);
        if (!result.ok && owners.get(context.ownerKey) === scope) { owners.delete(context.ownerKey); if (scopes.get(key) === scope) scopes.delete(key); }
        if(result.ok&&dragOwners.size){const yielded=await queued(scope,'present',{visible:false});if(yielded.snapshot)result.snapshot=yielded.snapshot;}
        if (result.ok&&visibility.get(context.ownerKey)!==false) for (const group of result.snapshot?.groups ?? []) {
          const tab = group.tabs.find(tab => tab.id === group.selected && tab.kind === 'dormant' && (tab as any).canOpen);
          if (tab && !autoResumed.has(`${key}:${tab.id}`)) {
            autoResumed.add(`${key}:${tab.id}`); void queued(scope,'resume',{tabId:tab.id});
          }
        }
        return result;
      } catch (error) { return { ok: false, error: String(error) }; }
    },
    command(owner, op, params = {}, revision) {if(['move','split','relocate-group'].includes(op))refusedDrag=undefined; if(op==='present'&&params.visible===true&&dragOwners.size)params={...params,visible:false}; const scope = owners.get(owner); return scope && commandNames.has(op) ? queued(scope, op, params, revision) : Promise.resolve(unavailable()); },
    attach(owner, handle, pid, groupId = 'main', retainedId) { const scope = owners.get(owner); return scope ? queued(scope, 'attach', { handle, pid, groupId, ...(retainedId ? { retainedId } : {}) }) : Promise.resolve(unavailable()); },
    open(owner, source, url, groupId) { const scope = owners.get(owner); return scope ? queued(scope, 'open', { source, url, ...(groupId ? { groupId } : {}) }) : Promise.resolve(unavailable()); },
    async move(owner, rect) { const scope = owners.get(owner); if (!scope) return unavailable();
      const result = await queued(scope, 'viewport', { rect: absolute(scope, rect) });
      if (result.ok) scope.rect = { ...rect, ...result.snapshot?.viewport };
      return result;
    },
    snapshot(owner) { return owners.get(owner)?.snapshot; },
    async canFitWindow(windowId,deltaWidth,deltaHeight) {
      for(const scope of owners.values())if(Number(scope.context.ownerKey.split(':')[0])===windowId&&visibility.get(scope.context.ownerKey)!==false){
        const rect={...scope.rect,width:scope.rect.width+deltaWidth,height:scope.rect.height+deltaHeight};
        if(rect.width<=0||rect.height<=0||!(await queued(scope,'can-fit',{rect:absolute(scope,rect)})).ok)return false;
      }
      return true;
    },
    async canFitPageGroup(windowId,surfaceIds,width,height,includeHidden=false){
      for(const scope of owners.values())if(surfaceIds.some(id=>scope.context.ownerKey===`${windowId}:${id}`)&&(includeHidden||visibility.get(scope.context.ownerKey)!==false)){
        const rect={...scope.rect,width:scope.rect.width+width-scope.context.surfaceBounds.width,height:scope.rect.height+height-scope.context.surfaceBounds.height};
        if(rect.width<=0||rect.height<=0||!(await queued(scope,'can-fit',{rect:absolute(scope,rect)},undefined,includeHidden)).ok)return false;
      }
      return true;
    },
    ownership(instanceId, callerOwner) {
      for (const scope of owners.values()) for (const group of scope.snapshot?.groups ?? []) for (const tab of group.tabs) {
        if (!tab.handle || !tab.pid || input.windowInstanceId?.(tab.handle, tab.pid) !== instanceId) continue;
        const samePage = scope.context.ownerKey === callerOwner;
        return { transferId: ticket(scope, tab.id), samePage,
          label: samePage ? 'another group' : input.ownerLabel?.(scope.context.ownerKey) ?? 'another Papers page' };
      }
      return undefined;
    },
    async reveal(owner, id) {
      if (!owners.has(owner)) return unavailable();
      const claim = claimFor(id); if (!claim) return { ok: false, error: 'This window is no longer in use there.' };
      await input.revealOwner?.(claim.scope.context.ownerKey);
      api.setOwnerVisible(claim.scope.context.ownerKey, true);
      return queued(claim.scope, 'select', { groupId: claim.groupId, tabId: claim.tabId });
    },
    transferCheck(owner,groupId,side){
      const drag=draggedTransfer?.id;return (async():Promise<PaneReply>=>{
      const target=owners.get(owner),source=draggedTransfer&&claimFor(draggedTransfer.id);
      if(!target||!source)return {ok:false,error:'That group drag is no longer active.'};
      if(source.tabId)return {ok:true};
      if(target===source.scope){const result=await queued(target,'can-relocate-group',{source:source.groupId,groupId,side});return result.ok?result:{ok:false,error:'The group cannot fit in that position.'};}
      if(side==='center')return checkSwap(source.scope,source.groupId,target,groupId);
      if(protectedGroup(source.scope,source.groupId))return {ok:false,error:'Files and Preview stay with their page.'};
      const minimum=await queued(source.scope,'group-minimum',{groupId:source.groupId});
      if(!minimum.ok)return minimum;
      const result=await queued(target,'can-insert-group',{groupId,side,width:minimum.width,height:minimum.height});
      return result.ok?result:{ok:false,error:'There is not enough room for that group split.'};
      })().then(reply=>{if(drag&&draggedTransfer?.id===drag)refusedDrag=reply.ok?undefined:drag;return reply;});
    },
    transfer(owner, id, groupId, side = 'center') {
      const origin=claimFor(id);refusedDrag=undefined;
      const task = transferTail.then(async (): Promise<PaneReply> => {
        const target = owners.get(owner), source = claimFor(id);
        if (!target || !source) return { ok: false, error: 'That window or group is no longer available.' };
        if (target === source.scope) return source.tabId
          ? side==='center' ? queued(target, 'move', { tabId: source.tabId, groupId }) : queued(target,'split',{tabId:source.tabId,groupId,newGroupId:randomUUID().replaceAll('-',''),side})
          : queued(target, 'relocate-group', { groupId: source.groupId, destination: groupId, side });
        if (!['center','left', 'right', 'top', 'bottom'].includes(side)) return { ok: false, error: 'Choose an edge for the incoming group.' };
        const from = source.scope;
        const movedGroup = from.snapshot?.groups.find(group=>group.id===source.groupId);
        if(movedGroup?.tabs.some(tab=>(!source.tabId||source.tabId===tab.id)&&(['preview:workspace-files','preview:workspace-preview'].includes(tab.id)||Boolean(tab.preview?.PageKey))))
          return {ok:false,error:'Files and Preview stay with their page. Move the page to another Papers window instead.'};
        const swap=!source.tabId&&side==='center';
        if(swap){const check=await checkSwap(from,source.groupId,target,groupId);if(!check.ok)return check;}
        locked.add(from); locked.add(target);
        const records: Array<{ key: string; mount: Record<string, any> }> = [];
        const run = async (scope: Scope, op: string, params: Record<string, unknown> = {}): Promise<PaneReply> => {
          const result = await queued(scope, op, params, undefined, true);
          if (!result.ok) throw new Error(result.error ?? 'Window transfer was refused.'); return result;
        };
        try {
          await run(from, 'checkpoint'); await run(target, 'checkpoint');
          for (const scope of [from, target]) records.push({ key: scope.key, mount: JSON.parse(fs.readFileSync(mountFile(scope.key), 'utf8')) });
          durableWrite(journalFile, { status: 'prepared', records });
          const group = from.snapshot!.groups.find(group => group.id === source.groupId)!;
          const tabs = group.tabs.filter(tab => !source.tabId || tab.id === source.tabId);
          const other=swap?target.snapshot!.groups.find(g=>g.id===groupId):undefined;
          if(swap&&!other)throw Error('The destination group no longer exists.');
          let destination = groupId;
          if (!swap&&(!source.tabId || side!=='center')) {
            destination = randomUUID().replaceAll('-', '');
            await run(target, 'create-group', { groupId, newGroupId: destination, side:side==='center'?'right':side });
          }
          if(swap){
            // Release every outgoing HWND before acquiring either incoming set.
            // The prepared journal compensates the whole exchange on failure.
            for(const [scope,outgoing] of [[from,tabs],[target,other!.tabs]] as const)
              for(const tab of outgoing)await run(scope,tab.kind==='document'?'document-remove':'detach',{tabId:tab.id});
          }
          const add=async(scope:Scope,tab:NativePaneSnapshot['groups'][number]['tabs'][number],destination:string,mount:Record<string,any>):Promise<void>=>{
            if(tab.kind==='native')await run(scope,'attach',{handle:tab.handle,pid:tab.pid,groupId:destination,retainedId:tab.id,restoreUrl:mount.Peers.find((p:any)=>p.TabId===tab.id)?.Url});
            else if(tab.kind==='document')await run(scope,'document-add',{tabId:tab.id,groupId:destination,preview:mount.DocumentReferences?.find((p:any)=>p.Id===tab.id)});
            else await run(scope,'dormant-add',{peer:mount.Peers.find((p:any)=>p.TabId===tab.id),groupId:destination});
          };
          for (const tab of tabs) {
            const op = tab.kind === 'document' ? 'document-remove' : 'detach';
            if(!swap)await run(from, op, { tabId: tab.id });
            await add(target,tab,destination,records[0]!.mount);
          }
          if(swap){for(const tab of other!.tabs)await add(from,tab,source.groupId,records[1]!.mount);
            if(other!.selected)await run(from,'select',{groupId:source.groupId,tabId:other!.selected});}
          if (!swap&&!source.tabId && from.snapshot!.groups.length > 1) await run(from, 'close-group', { groupId: source.groupId,
            destination: from.snapshot!.groups.find(group => group.id !== source.groupId)!.id });
          const selected = source.tabId ?? group.selected;
          if (selected) await run(target, 'select', { groupId: destination, tabId: selected });
          await run(from, 'checkpoint'); await run(target, 'checkpoint');
          durableWrite(journalFile, { status: 'committed', records: [from,target].map(scope=>({key:scope.key,mount:JSON.parse(fs.readFileSync(mountFile(scope.key),'utf8'))})) });
          // Settling prevents a later startup from replaying over subsequent edits.
          durableWrite(journalFile, { status: 'settled' });
          from.removedDocuments = tabs.filter(tab=>tab.kind==='document').map(tab=>tab.id);
          if(swap)target.removedDocuments=other!.tabs.filter(tab=>tab.kind==='document').map(tab=>tab.id);
          return { ok: true, tabId: source.tabId, snapshot: localSnapshot(target, target.snapshot!) };
        } catch (error) {
          // Release both leases, then remount the exact before-records. A
          // process death at any point leaves the prepared journal for boot.
          if (records.length === 2) {
            try { for (const scope of [from, target]) await run(scope, 'release'); }
            catch (rollback) { return {ok:false,error:'Recovery is saved for the next Papers launch: '+String(rollback)}; }
            for (const scope of [from, target]) {
              try {
                const generation = scope.snapshot?.bindingGeneration ?? 0;
                const record = records.find(record => record.key === scope.key)!;
                restoreCheckpoint(scope.key, { ...record.mount, BindingGeneration: generation + 1 });
                scope.token = randomUUID(); scope.snapshot = undefined;
                await run(scope, 'mount', { rect: absolute(scope, scope.rect), headerHeight: scope.headerHeight });
                await run(scope, 'present', {visible:visibility.get(scope.context.ownerKey)!==false&&dragOwners.size===0&&!hostOverlayActive(scope.context.ownerKey)});
              } catch (rollback) {
                return { ok: false, error: 'Transfer stopped. Recovery is saved for the next Papers launch: ' + String(rollback) };
              }
            }
            durableWrite(journalFile, { status: 'rolled-back', records });
          }
          return { ok: false, error: String(error) };
        } finally {
          locked.delete(from); locked.delete(target);
          for (const scope of [from,target]) if(owners.get(scope.context.ownerKey)===scope&&scope.snapshot) await queued(scope,'present',{visible:visibility.get(scope.context.ownerKey)!==false&&dragOwners.size===0});
          for (const scope of [from,target]) if (scope.snapshot && visibility.get(scope.context.ownerKey)!==false)
            input.onSnapshot?.(scope.context.ownerKey,localSnapshot(scope,scope.snapshot));
          from.removedDocuments=undefined;
          target.removedDocuments=undefined;
        }
      });
      transferTail = task.catch(() => undefined);
      return task.then(reply=>{if(!reply.ok&&origin?.scope.snapshot)input.onSnapshot?.(origin.scope.context.ownerKey,{...localSnapshot(origin.scope,origin.scope.snapshot),moveRejected:{id:randomUUID(),groupId:origin.groupId,tabId:origin.tabId}});return reply;});
    },
    dragOverlay(owner,active,transferId,cancelled=false) {
      const task=overlayTail.then(async()=>{
      if(active&&!owners.has(owner))return unavailable();
      if(active&&transferId){const claim=claimFor(transferId);if(!claim||claim.scope!==owners.get(owner))return unavailable();if(draggedTransfer?.id!==transferId)refusedDrag=undefined;draggedTransfer={owner,id:transferId};}
      if(!active&&draggedTransfer?.owner===owner){const source=refusedDrag===draggedTransfer.id?claimFor(draggedTransfer.id):undefined;if(!cancelled&&source?.scope.snapshot)input.onSnapshot?.(owner,{...localSnapshot(source.scope,source.scope.snapshot),moveRejected:{id:randomUUID(),groupId:source.groupId,tabId:source.tabId}});draggedTransfer=undefined;refusedDrag=undefined;}
      const previous=dragOwners.size, timer=dragOwners.get(owner);if(timer)clearTimeout(timer);
      if(active)dragOwners.set(owner,setTimeout(()=>{void api.dragOverlay(owner,false);},10000));else dragOwners.delete(owner);
      if(Boolean(previous)!==Boolean(dragOwners.size))await Promise.all([...owners.values()].map(scope=>queued(scope,'present',{visible:dragOwners.size===0&&visibility.get(scope.context.ownerKey)!==false})));
      const scope=owners.get(owner);
      return {ok:true,...(scope?.snapshot?{snapshot:localSnapshot(scope,scope.snapshot)}:{})};
      });
      overlayTail=task.catch(()=>undefined);return task;
    },
    async setHostOverlayActive(windowId, active) {
      if(active)hostOverlays.add(windowId);else hostOverlays.delete(windowId);
      await Promise.all([...owners.values()].filter(scope=>Number(scope.context.ownerKey.split(':')[0])===windowId)
        .map(scope=>queued(scope,'present',{visible:!active&&dragOwners.size===0&&visibility.get(scope.context.ownerKey)!==false})));
    },
    setOwnerVisible(owner, visible) { visibility.set(owner, visible); const scope = owners.get(owner); if (scope) {void queued(scope, 'present', { visible:visible&&dragOwners.size===0 });if(visible)for(const group of scope.snapshot?.groups??[]){const tab=group.tabs.find(tab=>tab.id===group.selected&&tab.kind==='dormant'&&(tab as any).canOpen);if(tab&&!autoResumed.has(`${scope.key}:${tab.id}`)){autoResumed.add(`${scope.key}:${tab.id}`);void queued(scope,'resume',{tabId:tab.id});}}} },
    setOwnerSurfaceBounds(owner, bounds) { const scope = owners.get(owner); if (scope) { scope.context = { ...scope.context, surfaceBounds: bounds }; void api.move(owner, scope.rect); } },
    async closeOwner(owner) { await transferTail; await api.dragOverlay(owner,false); const scope = owners.get(owner); if (!scope) return;
      await queued(scope, 'release'); if (owners.get(owner) === scope) owners.delete(owner); if (scopes.get(scope.key) === scope) scopes.delete(scope.key); visibility.delete(owner);
    },
    async dispose() {
      disposing = true;
      for(const timer of dragOwners.values())clearTimeout(timer);dragOwners.clear();
      const all = [...hosts.values()];
      let deadline:ReturnType<typeof setTimeout>|undefined;
      const drain=(async()=>{await transferTail;await overlayTail;await Promise.all(all.map(async live=>{await live.queue.catch(()=>undefined);await send(live,{op:'release-host'});live.child.stdin.end();}));})();
      try {
        await Promise.race([drain,new Promise<void>(resolve=>{deadline=setTimeout(()=>{
          // A stalled helper must not trap a saved restart. Its independent
          // recovery guard owns original native-window restoration.
          for(const live of all){live.stopped=true;for(const request of live.pending.values()){clearTimeout(request.timer);request.resolve(unavailable());}live.pending.clear();live.child.kill();}
          resolve();
        },20000);})]);
      } finally {if(deadline)clearTimeout(deadline);owners.clear();scopes.clear();hosts.clear();}
    },
  };
  return api;
}
