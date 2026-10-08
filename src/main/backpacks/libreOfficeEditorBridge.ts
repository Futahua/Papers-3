import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import {
  absolutePreviewRect, validPreviewRect,
  type PreviewHostContext, type PreviewRect,
} from './windowsPreviewHandlerBridge';

// Impress/Draw currently crash in LibreOffice's Windows system-child frame.
// Keep their existing preview/open behavior until a native editor path is proven.
export const OFFICE_EDITOR_EXTENSIONS = new Set(['.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods']);
import { createEditorRuntimePool } from './editorRuntimePool';
import { editorLoadProgress, type EditorLoadProgress } from './editorLoadProgress';
type Reply = { ok: boolean; message?: string; detached?: boolean; reusable?: boolean; hwnd?: string; readOnly?: boolean };
type OpenReply = Reply & { sessionId?: string; runtimeId?: string };
interface Runtime {
  id: string; child: ChildProcessWithoutNullStreams; alive: boolean; ready: Promise<Reply>;
  progress: EditorLoadProgress;
  usage: Record<string, unknown> | null;
  started: boolean;
  send(command: Record<string, unknown>): boolean;
  request(operation: string, params?: Record<string, unknown>): Promise<Reply>;
}
interface Session {
  id: string; ownerKey: string; runtime: Runtime; localRect: PreviewRect; surfaceBounds: PreviewRect;
  opening: boolean; loadId?: string; closing?: Promise<Reply>; closed: boolean;
}
export interface LibreOfficeEditorBridge {
  open(context: PreviewHostContext, target: string, rect: PreviewRect, loadId?: string): Promise<OpenReply>;
  status(ownerKey: string, loadId: string): EditorLoadProgress | null;
  prepare(): Promise<Reply>;
  setKeepWarm(value: boolean): void;
  snapshot(): Record<string, unknown>;
  move(ownerKey: string, id: string, rect: PreviewRect): boolean;
  focus(ownerKey: string, id: string): boolean;
  visible(ownerKey: string, id: string, visible: boolean): boolean;
  save(ownerKey: string, id: string): Promise<Reply>;
  close(ownerKey: string, id: string): Promise<Reply>;
  closeOwner(ownerKey: string): Promise<void>;
  closeWindow(windowId: number): Promise<void>;
  hasWindow(windowId: number): boolean;
  setOwnerSurfaceBounds(ownerKey: string, rect: PreviewRect): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  dispose(): Promise<void>;
}
export function resolveLibreOfficeEditorSourcePath(input: { appPath: string; resourcesPath: string; packaged: boolean }): string {
  return path.join(input.packaged ? path.join(input.resourcesPath, 'native') : path.join(input.appPath, 'resources', 'native'), 'libreoffice-editor.py');
}
export function createLibreOfficeEditorBridge(input: {
  officePath: string | null; sourcePath: string; cacheDirectory: string;
  spawnProcess?: typeof spawn;
}): LibreOfficeEditorBridge | null {
  if (!input.officePath || process.platform !== 'win32') return null;
  const program = path.dirname(input.officePath), python = path.join(program, 'python.exe');
  if (![python, path.join(program, 'soffice.bin'), input.sourcePath].every(file => fs.existsSync(file))) return null;
  const sessions = new Map<string, Session>();
  const ownerRequests = new Map<string, number>();
  let generation = 0, disposing = false;
  let keepWarm = true;
  const runtimes = new Set<Runtime>();
  let preparing: Promise<Reply> | null = null;
  const launch = input.spawnProcess ?? spawn;
  const pool = createEditorRuntimePool<Runtime>({
    keepWarm: () => keepWarm,
    usable: runtime => runtime.alive,
    retire(runtime) { runtime.alive = false; runtimes.delete(runtime); runtime.child.stdin.end(); },
    create() {
      const id = randomUUID(), profile = path.join(input.cacheDirectory, 'office-editors', id);
      const child = launch(python, ['-u', input.sourcePath, program, profile, 'papers_office_' + id.replaceAll('-', '')], {
        cwd: program, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      }) as ChildProcessWithoutNullStreams;
      let finishReady!: (value: Reply) => void;
      let readyFinished = false;
      const ready = new Promise<Reply>(resolve => { finishReady = resolve; });
      const pending = new Map<string, (value: Reply) => void>();
      const timer = setTimeout(() => finish({ ok: false, message: 'LibreOffice is taking too long to start.' }), 90_000);
      timer.unref?.();
      const runtime: Runtime = {
        id, child, alive: true, ready, started: false, usage: null, progress: editorLoadProgress({ phase: 'starting-engine', text: 'Starting LibreOffice…' }),
        send(command) {
          if (!runtime.alive) return false;
          try { child.stdin.write(JSON.stringify(command) + '\n'); return true; } catch { return false; }
        },
        request(operation, params = {}) {
          return new Promise(resolve => {
            const requestId = randomUUID();
            const timeout = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, message: 'LibreOffice did not finish the operation. Your document has not been discarded.' }); }, 90_000);
            timeout.unref?.();
            pending.set(requestId, value => { clearTimeout(timeout); resolve(value); });
            if (!runtime.send({ id: requestId, operation, ...params })) {
              pending.get(requestId)?.({ ok: false, message: 'The LibreOffice editor is no longer connected.' });
              pending.delete(requestId);
            }
          });
        },
      };
      function finish(value: Reply) {
        if (readyFinished) return;
        readyFinished = true; clearTimeout(timer); finishReady(value);
      }
      function retire(message: string) {
        runtime.alive = false;
        runtimes.delete(runtime);
        finish({ ok: false, message });
        for (const complete of pending.values()) complete({ ok: false, message });
        pending.clear();
      }
      child.stderr.on('data', () => undefined);
      child.stdin.on('error', error => retire(error.message));
      child.on('error', error => retire(error.message));
      child.on('exit', () => retire('The LibreOffice editor closed.'));
      createInterface({ input: child.stdout }).on('line', line => {
        if (Buffer.byteLength(line) > 16_384) return;
        let value: Record<string, unknown>;
        try { value = JSON.parse(line) as Record<string, unknown>; } catch { return; }
        if (!value || typeof value !== 'object') return;
        if (value.kind === 'usage') runtime.usage = value;
        else if (value.kind === 'progress') runtime.progress = editorLoadProgress(value);
        else if (value.kind === 'phase') runtime.progress = editorLoadProgress({ phase: value.phase, text: value.phase === 'loading-document' ? 'Opening document…' : 'Preparing editor…' });
        else if (value.kind === 'engine-ready') { runtime.started = true; finish({ ok: true }); }
        else if (value.kind === 'reply' && typeof value.id === 'string' && typeof value.ok === 'boolean') {
          const complete = pending.get(value.id); pending.delete(value.id);
          complete?.({ ok: value.ok, detached: value.detached === true, reusable: value.reusable === true,
            ...(typeof value.hwnd === 'string' ? { hwnd: value.hwnd, readOnly: value.readOnly === true } : {}),
            ...(typeof value.message === 'string' ? { message: value.message.slice(0, 1000) } : {}) });
        } else if (value.kind === 'error') retire(typeof value.message === 'string' ? value.message.slice(0, 1000) : 'LibreOffice could not start.');
      });
      runtimes.add(runtime);
      return runtime;
    },
  });
  const get = (ownerKey: string, id: string) => {
    const session = sessions.get(id);
    return session?.ownerKey === ownerKey && !session.closed && session.runtime.alive ? session : undefined;
  };
  const send = (session: Session, command: Record<string, unknown>) => !session.closed && !session.closing && session.runtime.send(command);
  const move = (session: Session) => {
    const rect = absolutePreviewRect(session.surfaceBounds, session.localRect);
    return send(session, { operation: 'move', rect: [rect.x, rect.y, rect.width, rect.height] });
  };
  const prepareRuntime = async (): Promise<Reply> => {
      if (disposing) return { ok: false, message: 'The editor is shutting down.' };
      const existing = [...runtimes].find(r => r.alive);
      if (existing) return existing.ready;
      if (preparing) return preparing;
      const runtime = pool.acquire();
      pool.release(runtime, true, true);
      preparing = runtime.ready.finally(() => { preparing = null; });
      return preparing;
  };
  const close = (session: Session): Promise<Reply> => {
    if (session.closing) return session.closing;
    session.closing = session.runtime.request('close').then(result => {
      if (result.ok || !session.runtime.alive) {
        session.closed = true; sessions.delete(session.id);
        pool.release(session.runtime, result.ok && result.reusable === true && !session.opening);
        if (result.detached && keepWarm && !disposing) void prepareRuntime().catch(() => undefined);
        // A crashed process has no live inline owner left to close.
        return result.ok ? result : { ok: true, reusable: false };
      }
      session.closing = undefined;
      return result;
    });
    return session.closing;
  };
  const closeMatching = async (matches: (session: Session) => boolean) => {
    const results = await Promise.all([...sessions.values()].filter(matches).map(close));
    const failed = results.find(result => !result.ok);
    if (failed) throw new Error(failed.message ?? 'Save the document before closing its editor.');
  };
  return {
    prepare: prepareRuntime,
    setKeepWarm(value) { keepWarm = value; if (!value) pool.trimIdle(); },
    snapshot() { return { activeDocuments: [...sessions.values()].filter(s => !s.opening && !s.closed).length, loadingDocuments: [...sessions.values()].filter(s => s.opening && !s.closed).length, runtimes: [...runtimes].filter(r => r.alive).map(r => ({ id: r.id, helperPid: r.child.pid, state: !r.started ? 'starting' : [...sessions.values()].some(s => s.runtime === r) ? 'active' : 'warm', usage: r.usage })) }; },
    async open(context, target, localRect, loadId) {
      if (disposing) return { ok: false, message: 'The editor is shutting down.' };
      if (!validPreviewRect(context.surfaceBounds) || !validPreviewRect(localRect) || !/^\d+$/.test(context.parentHwnd)) return { ok: false, message: 'Invalid inline editor geometry.' };
      if (!OFFICE_EDITOR_EXTENSIONS.has(path.extname(target).toLowerCase())) return { ok: false, message: 'This file type is not supported by the inline office editor.' };
      const requestGeneration = ++generation;
      ownerRequests.set(context.ownerKey, requestGeneration);
      const current = () => ownerRequests.get(context.ownerKey) === requestGeneration && !disposing;
      const cancelled = { ok: false, message: 'The editor was closed before it finished opening.' };
      const stat = await fs.promises.stat(target);
      if (!stat.isFile()) return { ok: false, message: 'Choose an office document to edit.' };
      if (!current()) return cancelled;
      await closeMatching(session => session.ownerKey === context.ownerKey);
      if (!current()) return cancelled;
      const id = randomUUID(), runtime = pool.acquire();
      const session: Session = { id, ownerKey: context.ownerKey, runtime, loadId, localRect: { ...localRect }, surfaceBounds: { ...context.surfaceBounds }, opening: true, closed: false };
      sessions.set(id, session);
      const started = await runtime.ready;
      if (session.closed || session.closing) return { ok: false, message: 'The editor was closed before it finished opening.' };
      runtime.progress = editorLoadProgress({ phase: 'loading-document', text: 'Opening document…' });
      const rect = absolutePreviewRect(session.surfaceBounds, session.localRect);
      const opened = started.ok ? await runtime.request('open', { path: target, parent: context.parentHwnd, rect: [rect.x, rect.y, rect.width, rect.height] }) : started;
      session.opening = false;
      if (session.closed || session.closing) return { ok: false, message: 'The editor was closed before it finished opening.' };
      if (!opened.ok || !opened.hwnd || !/^\d+$/.test(opened.hwnd)) {
        session.closed = true; sessions.delete(id); pool.release(runtime, false);
        return { ok: false, message: opened.message ?? 'LibreOffice could not open the editor.' };
      }
      return { ok: true, sessionId: id, runtimeId: runtime.id, readOnly: opened.readOnly === true };
    },
    status(ownerKey, loadId) { const session = [...sessions.values()].find(s => s.ownerKey === ownerKey && s.loadId === loadId && s.opening && !s.closed); return session ? { ...session.runtime.progress } : null; },
    move(ownerKey, id, rect) { const session = get(ownerKey, id); if (!session || !validPreviewRect(rect)) return false; session.localRect = { ...rect }; return move(session); },
    visible(ownerKey, id, visible) { const session = get(ownerKey, id); return session ? send(session, { operation: 'visible', visible }) : false; },
    focus(ownerKey, id) { const session = get(ownerKey, id); return session ? send(session, { operation: 'focus' }) : false; },
    async save(ownerKey, id) { const session = get(ownerKey, id); return session && !session.closing ? session.runtime.request('save') : { ok: false, message: 'The office editor is no longer open.' }; },
    async close(ownerKey, id) { const session = sessions.get(id); return session?.ownerKey === ownerKey && !session.closed ? close(session) : { ok: true }; },
    closeOwner(ownerKey) { ownerRequests.delete(ownerKey); return closeMatching(session => session.ownerKey === ownerKey); },
    hasWindow(windowId) { return [...sessions.values()].some(session => session.ownerKey.startsWith(`${windowId}:`)); },
    closeWindow(windowId) { for (const owner of ownerRequests.keys()) if (owner.startsWith(`${windowId}:`)) ownerRequests.delete(owner); return closeMatching(session => session.ownerKey.startsWith(`${windowId}:`)); },
    setOwnerSurfaceBounds(ownerKey, rect) { if (!validPreviewRect(rect)) return; for (const session of sessions.values()) if (session.ownerKey === ownerKey) { session.surfaceBounds = { ...rect }; move(session); } },
    setOwnerVisible(ownerKey, visible) { for (const session of sessions.values()) if (session.ownerKey === ownerKey) send(session, { operation: 'visible', visible }); },
    async dispose() { disposing = true; ownerRequests.clear(); try { await closeMatching(() => true); pool.dispose(); } catch (error) { disposing = false; throw error; } },
  };
}
