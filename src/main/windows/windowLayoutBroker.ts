import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface WindowLayoutBrokerItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowLayoutBroker {
  setHost(hwnd: string): Promise<boolean>;
  bind(surfaceId: string, windowInstanceId: string): Promise<boolean>;
  layout(items: WindowLayoutBrokerItem[]): void;
  release(surfaceId: string): Promise<boolean>;
  releaseAll(): Promise<boolean>;
  stop(): Promise<void>;
}

export interface WindowLayoutBrokerOptions {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  timeoutMs?: number;
  spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
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
  return `${source.length}:${source.subarray(0, 128).toString('base64')}`;
}

/**
 * Starts the deliberately tiny native companion. Compilation is cached in
 * Papers' user-data directory, following the existing foreground bridge
 * pattern. If Windows cannot compile or launch it, callers keep the existing
 * PowerShell follower instead of turning foreign windows into a hard failure.
 */
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

  const spawnProcess = options.spawnProcess ?? ((file) => spawn(file, [], {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  let child: ChildProcessWithoutNullStreams;
  try { child = spawnProcess(executable); } catch { return null; }

  const pending = new Map<string, { resolve: (value: boolean) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  let stopped = false;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { return; }
    if (!raw || typeof raw !== 'object') return;
    const id = (raw as { id?: unknown }).id;
    if (typeof id !== 'string') return;
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    waiter.resolve((raw as { ok?: unknown }).ok === true);
  });
  const terminal = (reason: unknown): void => {
    const error = new Error(`window layout broker stopped: ${errorText(reason)}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.once('error', terminal);
  child.once('exit', (code, signal) => terminal(`exit=${code ?? 'null'} signal=${signal ?? 'null'}`));

  function send(command: Record<string, unknown>, wait: boolean): Promise<boolean> {
    if (stopped || child.stdin.destroyed || !child.stdin.writable) return Promise.resolve(false);
    const id = `${++sequence}`;
    const payload = JSON.stringify({ ...command, id });
    if (!wait) {
      try { child.stdin.write(`${payload}\n`); return Promise.resolve(true); } catch { return Promise.resolve(false); }
    }
    return new Promise<boolean>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { child.stdin.write(`${payload}\n`); } catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  return {
    setHost: (hwnd) => send({ cmd: 'host', hwnd }, true).catch(() => false),
    bind: (surfaceId, windowInstanceId) => send({ cmd: 'bind', id: surfaceId, windowInstanceId }, true).catch(() => false),
    layout(items) {
      void send({ cmd: 'layout', items: items.map(({ id, x, y, width, height }) => ({ id, x, y, w: width, h: height })) }, false);
    },
    release: (surfaceId) => send({ cmd: 'release', id: surfaceId }, true).catch(() => false),
    releaseAll: () => send({ cmd: 'releaseAll' }, true).catch(() => false),
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
