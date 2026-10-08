import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { resolveWindowsCscPath } from '../windows/foregroundBridge';
// Native peers use the caller's host and layout coordinates, not a preview session.
interface LayoutRect { x: number; y: number; width: number; height: number; rightInset?: number; bottomInset?: number }
interface LayoutHostContext { ownerKey: string; parentHwnd: string; surfaceBounds: LayoutRect }

type Reply = { ok: boolean; error?: string; reused?: boolean; title?: string };
interface Live {
  child: ChildProcessWithoutNullStreams; context: LayoutHostContext; rect: LayoutRect;
  pending: Map<string, { resolve: (reply: Reply) => void; timer: ReturnType<typeof setTimeout> }>;
}
export interface PaneWindowTab { id: string; title: string; active: boolean; icon?: string; handle?: number; pid?: number }
export interface ChromePaneBridge {
  attachWindow?(context: LayoutHostContext, handle: number, pid: number, rect: LayoutRect): Promise<Reply>;
  dropTab?(owner: string, tabId: string, beforeId: string, shiftHeld?: boolean): Promise<Reply>;
  reorderTab?(owner: string, tabId: string, beforeId: string): Promise<Reply>;
  selectTab?(owner: string, tabId: string): Promise<Reply>;
  detachTab?(owner: string, tabId: string): Promise<Reply>;
  listTabs?(owner: string): void;
  open(context: LayoutHostContext, source: string, url: string, rect: LayoutRect): Promise<Reply>;
  move(owner: string, rect: LayoutRect): void;
  setPaneVisible(owner: string, visible: boolean): void;
  setOwnerVisible(owner: string, visible: boolean): void;
  setOwnerSurfaceBounds(owner: string, bounds: LayoutRect): void;
  closeOwner(owner: string): void;
  raiseWindow(windowId: number): void;
  dispose(): void;
}
export function createChromePaneBridge(input: { cacheDirectory: string; nativeDirectory: string; onLayout?: (owner: string, rect: LayoutRect) => void; onTabs?: (owner: string, tabs: PaneWindowTab[]) => void }): ChromePaneBridge | null {
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
  const claim = (owner: string): Live | undefined => {
    if (ownerVisibility.get(owner) === false) return undefined;
    const existing = owners.get(owner); if (existing) return existing;
    const layout = viewLayouts.get(owner); if (!layout) return undefined;
    for (const [previous, live] of owners) {
      if (windowKey(previous) !== windowKey(owner)) continue;
      owners.delete(previous); owners.set(owner, live);
      live.context = layout.context; live.rect = layout.rect;
      void rect(live); void send(live, 'tabs');
      return live;
    }
    return undefined;
  };
  return {
    async open(context, source, url, localRect) {
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
            if (candidate.context.parentHwnd !== context.parentHwnd) continue;
            owners.delete(previousOwner); owners.set(context.ownerKey, candidate);
            live = candidate; break;
          }
        }
        if (!live) {
          ensureBinary();
          const surface = 'window:' + context.ownerKey.slice(0, context.ownerKey.indexOf(':'));
          const linkState = path.join(input.cacheDirectory, 'chrome-link-tabs-' + createHash('sha256').update(surface).digest('hex').slice(0, 16) + '.json');
          if (!fs.existsSync(linkState)) {
            const inherited: Record<string, unknown> = {};
            const legacy = fs.readdirSync(input.cacheDirectory).filter(name => /^chrome-link-tabs-[a-f0-9]+\.json$/.test(name))
              .map(name => path.join(input.cacheDirectory, name)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
            for (const file of legacy) { try { Object.assign(inherited, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {} }
            fs.writeFileSync(linkState, JSON.stringify(inherited));
          }
          const child = spawn(executable, [chrome, context.parentHwnd, String(process.pid), linkState], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
          live = { child, context, rect: localRect, pending: new Map() }; owners.set(context.ownerKey, live);
          const current = live;
          createInterface({ input: child.stdout }).on('line', line => {
            try {
              const reply = JSON.parse(line) as { id: string; result: Reply; kind?: string; rect?: LayoutRect; tabs?: PaneWindowTab[] };
              if (reply.kind === 'tabs' && Array.isArray(reply.tabs)) {
                input.onTabs?.(current.context.ownerKey, reply.tabs); return;
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
      const ready = await this.open(context, 'workspace:attach', '', bounds);
      if (!ready.ok) return ready;
      const live = owners.get(context.ownerKey);
      return live ? send(live, 'attach', { handle, pid }) : { ok: false, error: 'Pane unavailable.' };
    },
    async dropTab(owner, tabId, beforeId, shiftHeld) { const live = claim(owner); return live ? send(live, 'tab-drop', { tabId, beforeId, shiftHeld: shiftHeld === true }) : { ok: false, error: 'Pane unavailable.' }; },
    async reorderTab(owner, tabId, beforeId) { const live = claim(owner); return live ? send(live, 'reorder', { tabId, beforeId }) : { ok: false, error: 'Pane unavailable.' }; },
    async selectTab(owner, tabId) { const live = claim(owner); return live ? send(live, 'select', { tabId }) : { ok: false, error: 'Pane unavailable.' }; },
    async detachTab(owner, tabId) { const live = claim(owner); return live ? send(live, 'detach', { tabId }) : { ok: false, error: 'Pane unavailable.' }; },
    listTabs(owner) { const live = claim(owner); if (live) void send(live, 'tabs'); },
    move(owner, bounds) { const layout = viewLayouts.get(owner); if (layout) layout.rect = bounds; const live = ownerVisibility.get(owner) === false ? undefined : owners.get(owner); if (live) { live.rect = bounds; void rect(live); } },
    setPaneVisible(owner, visible) { paneVisibility.set(owner, visible); if (ownerVisibility.get(owner) !== false) { claim(owner); visibility(owner); } },
    setOwnerVisible(owner, visible) {
      ownerVisibility.set(owner, visible);
      if (visible) {
        for (const previous of ownerVisibility.keys()) if (previous !== owner && windowKey(previous) === windowKey(owner)) ownerVisibility.set(previous, false);
        const live = claim(owner);
        if (!live) { const layout = viewLayouts.get(owner); if (layout) void this.open(layout.context, 'workspace:attach', '', layout.rect); }
        else { visibility(owner); void send(live, 'tabs'); }
      } else visibility(owner);
    },
    setOwnerSurfaceBounds(owner, bounds) { const layout = viewLayouts.get(owner); if (layout) layout.context = { ...layout.context, surfaceBounds: bounds }; const live = owners.get(owner); if (live) { live.context = { ...live.context, surfaceBounds: bounds }; void rect(live); } },
    closeOwner(owner) { viewLayouts.delete(owner); const live = owners.get(owner);
      if (live && [...viewLayouts.keys()].some(other => windowKey(other) === windowKey(owner))) {
        ownerVisibility.set(owner, false); paneVisibility.delete(owner); void send(live, 'visible', { visible: false }); return;
      }
      owners.delete(owner); ownerVisibility.delete(owner); paneVisibility.delete(owner); if (live) { void send(live, 'release'); live.child.stdin.end(); } },
    raiseWindow(windowId) { for (const [owner, live] of owners) if (owner.startsWith(`${windowId}:`) && ownerVisibility.get(owner) !== false && paneVisibility.get(owner) !== false) void send(live, 'raise'); },
    dispose() { viewLayouts.clear(); for (const owner of [...owners.keys()]) this.closeOwner(owner); },
  };
}
