import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { createNativePaneBridge, type NativePaneBridge, type NativePaneSnapshot, type PanePageTransfers } from './nativePaneBridge';
import { resolveWindowsCscPath } from '../windows/foregroundBridge';
// Native peers use the caller's host and layout coordinates, not a preview session.
interface LayoutRect { x: number; y: number; width: number; height: number; rightInset?: number; bottomInset?: number }
interface LayoutHostContext { paneGroup?: string; layoutKey?: string; ownerKey: string; parentHwnd: string; surfaceBounds: LayoutRect }

type Reply = { ok: boolean; error?: string; reused?: boolean; title?: string };
interface Live {
  child: ChildProcessWithoutNullStreams; context: LayoutHostContext; rect: LayoutRect;
  tabs?: PaneWindowTab[];
  pending: Map<string, { resolve: (reply: Reply) => void; timer: ReturnType<typeof setTimeout> }>;
}
export interface PaneWindowTab { id: string; title: string; active: boolean; icon?: string; handle?: number; pid?: number }
export interface ChromePaneBridge {
  coordinator?: NativePaneBridge | null;
  releaseForCoordinator?(owner: string): Promise<PaneWindowTab[]>;
  attachWindow?(context: LayoutHostContext, handle: number, pid: number, rect: LayoutRect): Promise<Reply>;
  dropTab?(owner: string, tabId: string, beforeId: string, shiftHeld?: boolean): Promise<Reply>;
  reorderTab?(owner: string, tabId: string, beforeId: string): Promise<Reply>;
  selectTab?(owner: string, tabId: string): Promise<Reply>;
  detachTab?(owner: string, tabId: string): Promise<Reply>;
  listTabs?(owner: string): void;
  /** Dock one program window over a rectangle of `context`'s page, in its own host (see programWindowService). */
  programOpen?(context: LayoutHostContext, template: string, handle: number, pid: number, rect: LayoutRect): Promise<Reply>;
  programMove?(owner: string, template: string, rect: LayoutRect): void | Promise<unknown>;
  programVisible?(owner: string, template: string, visible: boolean): void;
  programClose?(owner: string, template: string): void | Promise<void>;
  open(context: LayoutHostContext, source: string, url: string, rect: LayoutRect): Promise<Reply>;
  move(owner: string, rect: LayoutRect): void;
  setPaneVisible(owner: string, visible: boolean): void;
  setOwnerVisible(owner: string, visible: boolean): void;
  setOwnerSurfaceBounds(owner: string, bounds: LayoutRect): void;
  closeOwner(owner: string): void | Promise<void>;
  raiseWindow(windowId: number): void;
  dispose(): void;
}
export function createChromePaneBridge(input: { cacheDirectory: string; nativeDirectory: string; coordinateScale?: (owner: string) => number; onLayout?: (owner: string, rect: LayoutRect) => void; onTabs?: (owner: string, tabs: PaneWindowTab[]) => void; onSnapshot?: (owner: string, snapshot: NativePaneSnapshot) => void; windowInstanceId?: (handle: number, pid: number) => string | undefined; ownerLabel?: (owner: string) => string; revealOwner?: (owner: string) => Promise<void>; pageTransfers?: PanePageTransfers }): ChromePaneBridge | null {
  if (process.platform !== 'win32') return null;
  const chrome = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']]
    .filter((v): v is string => Boolean(v)).map(v => path.join(v, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(v => fs.existsSync(v));
  const compiler = resolveWindowsCscPath(process.env['WINDIR'] ?? 'C:\\Windows');
  if (!chrome || !compiler) return null;
  const sources = ['chrome-pane-host.cs', 'chrome-window-session.cs'].map(f => path.join(input.nativeDirectory, f));
  const executable = path.join(input.cacheDirectory, 'chrome-pane-host.exe');
  const stamp = executable + '.stamp';
  const ensureBinary = (): void => {
    const hash = createHash('sha256'); for (const source of sources) hash.update(fs.readFileSync(source));
    const digest = hash.digest('hex');
    if (fs.existsSync(executable) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === digest) return;
    fs.mkdirSync(input.cacheDirectory, { recursive: true });
    const wpf = path.join(path.dirname(compiler), 'WPF');
    execFileSync(compiler, ['/nologo', '/target:exe', `/out:${executable}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', ...['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'].map(f => `/r:${path.join(wpf, f)}`), ...sources], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
    fs.writeFileSync(stamp, digest);
  };
  const coordinator = createNativePaneBridge({ cacheDirectory: input.cacheDirectory, nativeDirectory: input.nativeDirectory, coordinateScale: input.coordinateScale, onSnapshot: input.onSnapshot, windowInstanceId: input.windowInstanceId, ownerLabel:input.ownerLabel,revealOwner:input.revealOwner,pageTransfers:input.pageTransfers });
  const nativeGroup = (owner: string, tab: string): string => coordinator?.snapshot(owner)?.groups.find(g => g.tabs.some(t => t.id === tab))?.id ?? 'main';
  const owners = new Map<string, Live>();
  const viewLayouts = new Map<string, { context: LayoutHostContext; rect: LayoutRect }>();
  const ownerVisibility = new Map<string, boolean>();
  const paneVisibility = new Map<string, boolean>();
  const send = (live: Live, op: string, params: object = {}): Promise<Reply> => new Promise(resolve => {
    const id = randomUUID();
    const timer = setTimeout(() => { live.pending.delete(id); resolve({ ok: false, error: 'Chrome pane request timed out.' }); }, 14000);
    live.pending.set(id, { resolve, timer });
    live.child.stdin.write(JSON.stringify({ id, op, ...params }) + '\n', error => {
      if (!error) return; clearTimeout(timer); live.pending.delete(id); resolve({ ok: false, error: error.message });
    });
  });
  const rect = (live: Live): Promise<Reply> => send(live, 'rect', {
    x: live.context.surfaceBounds.x + live.rect.x, y: live.context.surfaceBounds.y + live.rect.y,
    width: live.rect.width, height: live.rect.height,
    ...(live.rect.rightInset === undefined ? {} : { rightInset: live.rect.rightInset }),
    ...(live.rect.bottomInset === undefined ? {} : { bottomInset: live.rect.bottomInset }),
  });
  const visibility = (owner: string): void => {
    const live = owners.get(owner); if (!live) return;
    void send(live, 'visible', { visible: ownerVisibility.get(owner) !== false && paneVisibility.get(owner) !== false });
  };
  const windowKey = (owner: string): string => owner.slice(0, owner.indexOf(':'));
  const groupKey = (context: LayoutHostContext): string => context.paneGroup ? windowKey(context.ownerKey) + ':backpack:' + context.paneGroup : windowKey(context.ownerKey);
  const claim = (owner: string): Live | undefined => {
    if (ownerVisibility.get(owner) === false) return undefined;
    const existing = owners.get(owner); if (existing) return existing;
    const layout = viewLayouts.get(owner); if (!layout) return undefined;
    for (const [previous, live] of owners) {
      if (groupKey(live.context) !== groupKey(layout.context)) continue;
      owners.delete(previous); owners.set(owner, live);
      live.context = layout.context; live.rect = layout.rect;
      void rect(live); void send(live, 'tabs');
      return live;
    }
    return undefined;
  };
  // Program windows docked into a page (programWindowService). With the pane
  // coordinator each is a scope of it, keyed `<page owner>~program~<template>`,
  // so the coordinator's one host per Papers window orders it together with the
  // page's own window tabs. Without the coordinator an isolated legacy host keyed
  // `program~<template>~<page owner>` is used, so it never claims or hides the
  // page's own host. Either way it follows its page's visibility, bounds and
  // lifetime. One window per template: docking it elsewhere releases it here.
  interface DockedProgram { key: string; template: string; handle: number; shown: boolean; coordinated: boolean }
  const programs = new Map<string, Map<string, DockedProgram>>();
  const pageVisible = new Map<string, boolean>();
  const programKey = (owner: string, template: string, coordinated: boolean): string => coordinated ? `${owner}~program~${template}` : `program~${template}~${owner}`;
  const dockedProgram = (owner: string, template: string): DockedProgram | undefined => [...(programs.get(owner)?.values() ?? [])].find(entry => entry.template === template);
  const showProgram = (entry: DockedProgram, owner: string): void => {
    const page = pageVisible.get(owner) !== false;
    if (entry.coordinated) { coordinator?.setOwnerVisible(entry.key, page && entry.shown); return; }
    ownerVisibility.set(entry.key, page); paneVisibility.set(entry.key, entry.shown); visibility(entry.key);
  };
  const bridge: ChromePaneBridge = {
    coordinator,
    async releaseForCoordinator(owner) {
      const live = claim(owner); if (!live) return [];
      const tabs = live.tabs ?? [];
      const result = await send(live, 'release');
      if (!result.ok) throw new Error(result.error ?? 'Existing pane could not release its windows.');
      owners.delete(owner); viewLayouts.delete(owner); live.child.stdin.end(); return tabs;
    },
    async open(context, source, url, localRect) {
      if (coordinator?.has(context.ownerKey)) return source === 'workspace:attach' ? { ok: true } : coordinator.open(context.ownerKey, source, url);
      try {
        viewLayouts.set(context.ownerKey, { context, rect: localRect });
        // Hidden pages may initialize or finish old requests after presentation
        // changed. They must never take the shared native group from the view
        // currently on screen.
        if (ownerVisibility.get(context.ownerKey) === false) return { ok: true };
        let live = claim(context.ownerKey);
        if (!live) {
          // A host has one Chrome connection, shared by its logical views.
          for (const [previousOwner, candidate] of owners) {
            if (candidate.context.parentHwnd !== context.parentHwnd || groupKey(candidate.context) !== groupKey(context)) continue;
            owners.delete(previousOwner); owners.set(context.ownerKey, candidate);
            live = candidate; break;
          }
        }
        if (!live) {
          ensureBinary();
          const surface = 'window:' + groupKey(context);
          const linkState = path.join(input.cacheDirectory, 'chrome-link-tabs-' + createHash('sha256').update(surface).digest('hex').slice(0, 16) + '.json');
          if (!fs.existsSync(linkState) && !context.paneGroup) {
            const inherited: Record<string, unknown> = {};
            const legacy = fs.readdirSync(input.cacheDirectory).filter(name => /^chrome-link-tabs-[a-f0-9]+\.json$/.test(name))
              .map(name => path.join(input.cacheDirectory, name)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
            for (const file of legacy) { try { Object.assign(inherited, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {} }
            fs.writeFileSync(linkState, JSON.stringify(inherited));
          }
          const child = spawn(executable, [chrome, context.parentHwnd, String(process.pid), linkState, ...(context.paneGroup ? ['isolated'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
          live = { child, context, rect: localRect, pending: new Map() }; owners.set(context.ownerKey, live);
          const current = live;
          createInterface({ input: child.stdout }).on('line', line => {
            try {
              const reply = JSON.parse(line) as { id: string; result: Reply; kind?: string; rect?: LayoutRect; tabs?: PaneWindowTab[] };
              if (reply.kind === 'tabs' && Array.isArray(reply.tabs)) {
                current.tabs = reply.tabs; input.onTabs?.(current.context.ownerKey, reply.tabs); return;
              }
              if (reply.kind === 'layout' && reply.rect && Object.values(reply.rect).every(Number.isFinite) && reply.rect.width > 0 && reply.rect.height > 0) {
                const bounds = current.context.surfaceBounds;
                const local = { ...reply.rect, x: reply.rect.x - bounds.x, y: reply.rect.y - bounds.y };
                current.rect = { ...current.rect, ...local };
                input.onLayout?.(current.context.ownerKey, local);
                return;
              }
              const request = current.pending.get(reply.id); if (request) { clearTimeout(request.timer); current.pending.delete(reply.id); request.resolve(reply.result); }
            } catch { /* not a response */ }
          });
          const retire = (): void => {
            if (owners.get(current.context.ownerKey) === current) owners.delete(current.context.ownerKey);
            for (const request of current.pending.values()) { clearTimeout(request.timer); request.resolve({ ok: false, error: 'Chrome pane helper stopped.' }); } current.pending.clear();
          };
          child.on('exit', retire); child.on('error', retire); child.stderr.on('data', () => {});
        }
        live.context = context; live.rect = localRect;
        const positioned = await rect(live); if (!positioned.ok) return positioned;
        if (owners.get(context.ownerKey) !== live || ownerVisibility.get(context.ownerKey) === false) return { ok: true };
        const result: Reply = source === 'workspace:attach' ? { ok: true } : await send(live, 'open', { source, url, present: ownerVisibility.get(context.ownerKey) !== false && paneVisibility.get(context.ownerKey) !== false });
        visibility(context.ownerKey);
        // A newly active view needs the retained strip even when the native
        // window list did not change during the ownership transfer.
        if (result.ok) void send(live, 'tabs');
        return result;
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    },
    async attachWindow(context, handle, pid, bounds) {
      if (coordinator?.has(context.ownerKey)) return coordinator.attach(context.ownerKey, handle, pid);
      const ready = await this.open(context, 'workspace:attach', '', bounds);
      if (!ready.ok) return ready;
      const live = owners.get(context.ownerKey);
      return live ? send(live, 'attach', { handle, pid }) : { ok: false, error: 'Pane unavailable.' };
    },
    async programOpen(context, template, handle, pid, bounds) {
      const coordinated = Boolean(coordinator), key = programKey(context.ownerKey, template, coordinated);
      for (const [page, docked] of programs) for (const other of [...docked.values()]) {
        if (other.key === key || other.template !== template) continue;
        docked.delete(other.key); if (!docked.size) programs.delete(page); await releaseProgram(other);
      }
      const docked = programs.get(context.ownerKey) ?? new Map<string, DockedProgram>(); programs.set(context.ownerKey, docked);
      const existing = docked.get(key);
      if (existing && existing.handle === handle) { existing.shown = true; bridge.programMove!(context.ownerKey, template, bounds); showProgram(existing, context.ownerKey); return { ok: true }; }
      const entry: DockedProgram = { key, template, handle, shown: true, coordinated };
      let reply: Reply;
      if (coordinator) {
        if (!coordinator.has(key)) {
          const mounted = await coordinator.mount({ ...context, ownerKey: key, layoutKey: key }, bounds, 0);
          if (!mounted.ok) { await coordinator.closeOwner(key); return { ok: false, error: mounted.error ?? 'The program window could not be placed here.' }; }
        } else await coordinator.move(key, bounds);
        coordinator.setOwnerVisible(key, pageVisible.get(context.ownerKey) !== false);
        // The window may be a tab of a pane's own layout; a window has one host, so the blob takes it from there.
        if (coordinator.snapshot(key)?.groups.some(group => group.tabs.some(tab => tab.handle === handle))) reply = { ok: true };
        else { await coordinator.releaseWindow(handle); const attached = await coordinator.attach(key, handle, pid, 'main'); reply = { ok: attached.ok, ...(attached.error ? { error: attached.error } : {}) }; }
      } else {
        ownerVisibility.set(key, pageVisible.get(context.ownerKey) !== false); paneVisibility.set(key, true);
        reply = await bridge.attachWindow!({ ...context, ownerKey: key, paneGroup: 'program:' + template }, handle, pid, bounds);
      }
      if (reply.ok) { docked.set(key, entry); showProgram(entry, context.ownerKey); }
      // A failed dock must not leave a host or scope behind without a window.
      else { if (!docked.size) programs.delete(context.ownerKey); await releaseProgram(entry); }
      return reply;
    },
    programMove(owner, template, bounds) {
      const entry = dockedProgram(owner, template); if (!entry) return;
      if (entry.coordinated) return coordinator?.move(entry.key, bounds); bridge.move(entry.key, bounds);
    },
    programVisible(owner, template, visible) {
      const entry = dockedProgram(owner, template); if (!entry) return;
      entry.shown = visible; showProgram(entry, owner);
    },
    programClose(owner, template) {
      const entry = dockedProgram(owner, template), docked = programs.get(owner); if (!entry) return;
      docked?.delete(entry.key); if (docked && !docked.size) programs.delete(owner);
      return releaseProgram(entry);
    },
    async dropTab(owner, tabId, beforeId, shiftHeld) { if (coordinator?.has(owner)) return coordinator.command(owner, shiftHeld ? 'detach' : 'reorder', { tabId, beforeId, groupId: nativeGroup(owner, tabId) }); const live = claim(owner); return live ? send(live, 'tab-drop', { tabId, beforeId, shiftHeld: shiftHeld === true }) : { ok: false, error: 'Pane unavailable.' }; },
    async reorderTab(owner, tabId, beforeId) { if (coordinator?.has(owner)) return coordinator.command(owner, 'reorder', { tabId, beforeId, groupId: nativeGroup(owner, tabId) }); const live = claim(owner); return live ? send(live, 'reorder', { tabId, beforeId }) : { ok: false, error: 'Pane unavailable.' }; },
    async selectTab(owner, tabId) { if (coordinator?.has(owner)) return coordinator.command(owner, 'select', { tabId, groupId: nativeGroup(owner, tabId) }); const live = claim(owner); return live ? send(live, 'select', { tabId }) : { ok: false, error: 'Pane unavailable.' }; },
    async detachTab(owner, tabId) { if (coordinator?.has(owner)) return coordinator.command(owner, 'detach', { tabId }); const live = claim(owner); return live ? send(live, 'detach', { tabId }) : { ok: false, error: 'Pane unavailable.' }; },
    listTabs(owner) { if (coordinator?.has(owner)) { void coordinator.command(owner, 'snapshot'); return; } const live = claim(owner); if (live) void send(live, 'tabs'); },
    move(owner, bounds) { if (coordinator?.has(owner)) return; const layout = viewLayouts.get(owner); if (layout) layout.rect = bounds; const live = ownerVisibility.get(owner) === false ? undefined : owners.get(owner); if (live) { live.rect = bounds; void rect(live); } },
    setPaneVisible(owner, visible) {
      // Legacy preview teardown can arrive after coordinator mount. Its local
      // visibility is no longer scope visibility; only pane-layout present and
      // authoritative owner visibility may control the mounted composition.
      if (coordinator?.has(owner)) return;
      paneVisibility.set(owner, visible);
      if (ownerVisibility.get(owner) !== false) { claim(owner); visibility(owner); }
    },
    setOwnerVisible(owner, visible) {
      pageVisible.set(owner, visible); for (const entry of programs.get(owner)?.values() ?? []) showProgram(entry, owner);
      coordinator?.setOwnerVisible(owner, visible);
      if (coordinator?.has(owner)) { ownerVisibility.set(owner, visible); return; }
      ownerVisibility.set(owner, visible);
      if (visible) {
        for (const previous of ownerVisibility.keys()) if (previous !== owner && windowKey(previous) === windowKey(owner)) { ownerVisibility.set(previous, false); visibility(previous); }
        const live = claim(owner);
        if (!live) { const layout = viewLayouts.get(owner); if (layout) void this.open(layout.context, 'workspace:attach', '', layout.rect); }
        else { visibility(owner); void send(live, 'tabs'); }
      } else visibility(owner);
    },
    setOwnerSurfaceBounds(owner, bounds) {
      for (const entry of programs.get(owner)?.values() ?? []) {
        if (entry.coordinated) { coordinator?.setOwnerSurfaceBounds(entry.key, bounds); continue; }
        const live = owners.get(entry.key); const layout = viewLayouts.get(entry.key); if (layout) layout.context = { ...layout.context, surfaceBounds: bounds }; if (live) { live.context = { ...live.context, surfaceBounds: bounds }; void rect(live); }
      }
      coordinator?.setOwnerSurfaceBounds(owner, bounds); if (coordinator?.has(owner)) return; const layout = viewLayouts.get(owner); if (layout) layout.context = { ...layout.context, surfaceBounds: bounds }; const live = owners.get(owner); if (live) { live.context = { ...live.context, surfaceBounds: bounds }; void rect(live); } },
    closeOwner(owner) {
      const docked = programs.get(owner); if (docked) { programs.delete(owner); for (const entry of docked.values()) void releaseProgram(entry); } pageVisible.delete(owner);
      const released=coordinator?.has(owner)?coordinator.closeOwner(owner):Promise.resolve(); viewLayouts.delete(owner); const live = owners.get(owner);
      if (live && [...viewLayouts.values()].some(other => groupKey(other.context) === groupKey(live.context))) {
        ownerVisibility.set(owner, false); paneVisibility.delete(owner); void send(live, 'visible', { visible: false }); return released;
      }
      owners.delete(owner); ownerVisibility.delete(owner); paneVisibility.delete(owner); if (live) { void send(live, 'release'); live.child.stdin.end(); } return released; },
    raiseWindow(windowId) { for (const owner of ownerVisibility.keys()) if (owner.startsWith(`${windowId}:`) && ownerVisibility.get(owner) !== false && coordinator?.has(owner)) void coordinator.command(owner, 'raise'); for (const [owner, live] of owners) if (owner.startsWith(`${windowId}:`) && ownerVisibility.get(owner) !== false && paneVisibility.get(owner) !== false) void send(live, 'raise');
      for (const [page, docked] of programs) if (page.startsWith(`${windowId}:`) && pageVisible.get(page) !== false) for (const entry of docked.values()) {
        if (!entry.shown) continue;
        if (entry.coordinated) void coordinator?.command(entry.key, 'raise'); else { const live = owners.get(entry.key); if (live) void send(live, 'raise'); }
      } },
    dispose() { void coordinator?.dispose(); viewLayouts.clear(); for (const owner of [...owners.keys()]) this.closeOwner(owner); },
  };
  async function releaseProgram(entry: DockedProgram): Promise<void> {
    if (entry.coordinated) await coordinator?.closeOwner(entry.key); else await bridge.closeOwner(entry.key);
  }
  return bridge;
}
