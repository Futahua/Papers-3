import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { WindowHelperResourcePaths } from './windowHelperResource';
import { parseWindowLifecycleMessage, type WindowLifecycleBaseline, type WindowLifecycleEvent, type WindowLifecycleMessage } from './windowLifecycleTypes';

export interface WindowLifecycleWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): WindowLifecycleBaseline | null;
  onEvent(callback: (event: WindowLifecycleEvent) => void): () => void;
  getSessionId(): string | null;
}

export function createWindowLifecycleWatcher(options: {
  runtimePath: string;
  paths: WindowHelperResourcePaths;
  spawnProcess?: (runtimePath: string, scriptPath: string) => ChildProcessWithoutNullStreams;
}): WindowLifecycleWatcher {
  const spawnProcess = options.spawnProcess ?? ((runtimePath, scriptPath) => spawn(runtimePath, ['-NoProfile', '-NonInteractive', '-File', scriptPath], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }));
  let child: ChildProcessWithoutNullStreams | null = null;
  let snapshotValue: WindowLifecycleBaseline | null = null;
  let sessionId: string | null = null;
  let stopping: Promise<void> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restartAttempts = 0;
  const listeners = new Set<(event: WindowLifecycleEvent) => void>();
  let lineReader: readline.Interface | null = null;

  async function start(): Promise<void> {
    if (child) return;
    const watcherPath = path.join(options.paths.directory, 'window-watcher.ps1');
    child = spawnProcess(options.runtimePath, watcherPath);
    lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on('line', (line) => {
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { return; }
      const message = parseWindowLifecycleMessage(raw);
      if (!message) return;
      consume(message);
    });
    child.once('exit', () => {
      lineReader?.close();
      lineReader = null;
      child = null;
      if (!stopping && restartAttempts < 3) {
        restartAttempts += 1;
        restartTimer = setTimeout(() => {
          restartTimer = null;
          void start().catch(() => undefined);
        }, 250 * restartAttempts);
      }
    });
  }

  function consume(message: WindowLifecycleMessage): void {
    sessionId = message.trackerSessionId;
    if (message.type === 'baseline') {
      snapshotValue = message;
      restartAttempts = 0;
      return;
    }
    for (const listener of [...listeners]) {
      try { listener(message); } catch { /* listeners are isolated */ }
    }
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    const current = child;
    if (!current) return Promise.resolve();
    const pending = new Promise<void>((resolve) => {
      current.once('exit', () => resolve());
      try { current.kill(); } catch { resolve(); }
    }).finally(() => { stopping = null; });
    stopping = pending;
    return pending;
  }

  return {
    start,
    stop,
    snapshot: () => snapshotValue,
    onEvent: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
    getSessionId: () => sessionId,
  };
}
