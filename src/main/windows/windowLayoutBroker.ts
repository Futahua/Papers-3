import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createHash } from 'node:crypto';

export interface WindowLayoutHostBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Native child-host companion for the personal foreign-window feature. */
export interface WindowLayoutBroker {
  createHost(surfaceId: string, papersHwnd: string): Promise<boolean>;
  adopt(surfaceId: string, windowInstanceId: string): Promise<boolean>;
  setBounds(surfaceId: string, bounds: WindowLayoutHostBounds): Promise<boolean>;
  setVisible(surfaceId: string, visible: boolean): Promise<boolean>;
  release(surfaceId: string): Promise<boolean>;
  releaseAll(): Promise<boolean>;
  stop(): Promise<void>;
}

export interface WindowLayoutBrokerOptions {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  timeoutMs?: number;
  spawnProcess?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams;
}

export const WINDOW_LAYOUT_BROKER_EXECUTABLE = 'papers-window-layout-broker.exe';

export function resolveWindowsCscPath(systemRoot: string): string | null {
  if (!systemRoot) return null;
  const path64 = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const path32 = path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  for (const candidate of [path64, path32]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* try the other architecture */ }
  }
  return null;
}

export function resolveWindowLayoutBrokerSourcePath(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): string {
  const directory = input.packaged
    ? path.join(input.resourcesPath, 'window-layout-broker')
    : path.join(input.appPath, 'resources', 'window-layout-broker');
  return path.join(directory, 'WindowLayoutBroker.cs');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stampFor(source: Buffer): string {
  return createHash('sha256').update(source).digest('hex');
}

/** Compiles and starts the tiny native child-host companion. If Windows cannot
 * compile or launch it, callers fail closed instead of moving a top-level
 * application window around the desktop. */
export function createWindowLayoutBroker(options: WindowLayoutBrokerOptions): WindowLayoutBroker | null {
  if (process.env.PAPERS_DISABLE_NATIVE_LAYOUT_BROKER === '1') return null;
  let source: Buffer;
  try { source = fs.readFileSync(options.sourcePath); } catch { return null; }

  const executable = path.join(options.cacheDirectory, WINDOW_LAYOUT_BROKER_EXECUTABLE);
  const stampPath = `${executable}.stamp`;
  const sourceStamp = stampFor(source);
  let ready = false;
  try { ready = fs.statSync(executable).isFile() && fs.readFileSync(stampPath, 'utf8') === sourceStamp; } catch { ready = false; }
  if (!ready) {
    const compiler = options.compilerPath ?? resolveWindowsCscPath(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows');
    if (!compiler) return null;
    try {
      fs.mkdirSync(options.cacheDirectory, { recursive: true });
      execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', `/out:${executable}`, options.sourcePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: options.timeoutMs ?? 10000,
        windowsHide: true,
      });
      fs.writeFileSync(stampPath, sourceStamp, 'utf8');
    } catch {
      try { fs.rmSync(executable, { force: true }); fs.rmSync(stampPath, { force: true }); } catch { /* best effort */ }
      return null;
    }
  }

  const spawnProcess = options.spawnProcess ?? ((file, args) => spawn(file, args, {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  let child: ChildProcessWithoutNullStreams;
  try { child = spawnProcess(executable, ['--parent-pid', String(process.pid)]); } catch { return null; }

  const pending = new Map<string, { resolve: (value: boolean) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0;
  let stopped = false;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { return; }
    if (!raw || typeof raw !== 'object') return;
    const requestId = (raw as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') return;
    const waiter = pending.get(requestId);
    if (!waiter) return;
    pending.delete(requestId);
    clearTimeout(waiter.timer);
    waiter.resolve((raw as { ok?: unknown }).ok === true);
  });
  const terminal = (reason: unknown): void => {
    stopped = true;
    const error = new Error(`window layout host stopped: ${errorText(reason)}`);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  };
  child.once('error', terminal);
  child.once('exit', (code, signal) => terminal(`exit=${code ?? 'null'} signal=${signal ?? 'null'}`));

  function send(command: Record<string, unknown>): Promise<boolean> {
    if (stopped || child.stdin.destroyed || !child.stdin.writable) return Promise.resolve(false);
    const requestId = `${++sequence}`;
    const payload = JSON.stringify({ ...command, requestId });
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(requestId)) return;
        resolve(false);
      }, options.timeoutMs ?? 1000);
      pending.set(requestId, { resolve, reject, timer });
      try { child.stdin.write(`${payload}\n`); } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return {
    createHost: (surfaceId, papersHwnd) => send({ cmd: 'host-create', surfaceId, papersHwnd }).catch(() => false),
    adopt: (surfaceId, windowInstanceId) => send({ cmd: 'adopt', surfaceId, windowInstanceId }).catch(() => false),
    setBounds: (surfaceId, bounds) => send({ cmd: 'host-bounds', surfaceId, x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }).catch(() => false),
    setVisible: (surfaceId, visible) => send({ cmd: 'host-visible', surfaceId, visible }).catch(() => false),
    release: (surfaceId) => send({ cmd: 'release', surfaceId }).catch(() => false),
    releaseAll: () => send({ cmd: 'releaseAll' }).catch(() => false),
    async stop() {
      if (stopped) return;
      stopped = true;
      try { child.stdin.end(); } catch { /* already closed */ }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      lines.close();
    },
  };
}
