import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { resolveWindowsCscPath } from './foregroundBridge';
import { defaultWindowGeometryJournal } from './windowGeometryJournal';

export interface ControlRegistration {
  id: number;
  hwnd: number;
  pid: number;
  processStartTicks: string;
  windowClass: string;
  ownerHwnd: number;
  hit: { x: number; y: number; width: number; height: number };
  restore: { x: number; y: number; width: number; height: number };
}

export interface ControlEvent {
  seq: number;
  id: number;
  operation: 'minimize' | 'restore' | 'foreground' | 'toggle';
  inputQpc: string;
  dispatchQpc: string;
  confirmedQpc: string;
  result: string;
}

export interface WindowControlBroker {
  readonly ready: boolean;
  register(slot: ControlRegistration): Promise<boolean>;
  clear(id: number): void;
  group(actions: Array<{ id: number; operation: 'minimize' | 'restore' | 'foreground' | 'toggle' }>): boolean;
  onEvent(listener: (event: ControlEvent) => void): () => void;
  onShift(listener: (held: boolean) => void): () => void;
  stop(): void;
}

const EXECUTABLE = 'papers-window-control.exe';
const SOURCE = 'window-control.cs';
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 60_000;

export function createWindowControlBroker(input: {
  cacheDirectory: string;
  sourcePath: string;
  onUnavailable: (reason: string) => void;
}): WindowControlBroker {
  let child: ChildProcess | null = null;
  let ready = false;
  let stopped = false;
  let restartTimes: number[] = [];
  let retryTimer: NodeJS.Timeout | null = null;
  let generation = 0;
  const listeners = new Set<(event: ControlEvent) => void>();
  const shiftListeners = new Set<(held: boolean) => void>();
  const pending = new Map<number, (ok: boolean) => void>();
  const registrations = new Map<number, ControlRegistration>();
  const executable = path.join(input.cacheDirectory, EXECUTABLE);
  const stampFile = executable + '.stamp';
  const telemetryFile = path.join(input.cacheDirectory, 'window-control-telemetry.log');

  /** Why a registration did not take. Bounded, and never on the click path. */
  function noteRefusal(reason: string): void {
    try {
      defaultWindowGeometryJournal().record({
        kind: 'observe-fail',
        title: 'control-register',
        detail: reason.slice(0, 90),
        outcome: 'refused',
      });
    } catch { /* diagnostics never fail the action they describe */ }
  }
  function fail(reason: string): void {
    ready = false;
    for (const resolve of pending.values()) resolve(false);
    pending.clear();
    input.onUnavailable(reason);
  }
  function send(line: string): boolean {
    if (!ready || !child?.stdin || child.stdin.destroyed) return false;
    try {
      // stream.write(false) means the bytes were buffered and backpressure is
      // active. It does not mean the command failed. Treating it as failure
      // made a queued registration look refused, then queued a clear behind it.
      child.stdin.write(line + '\n');
      return true;
    } catch { return false; }
  }
  function compile(): boolean {
    noteRefusal('compiling native control');
    try {
      const source = fs.readFileSync(input.sourcePath);
      const stamp = createHash('sha256').update(source).digest('hex');
      if (fs.existsSync(executable) && fs.existsSync(stampFile)
        && fs.readFileSync(stampFile, 'utf8') === stamp) return true;
      const compiler = resolveWindowsCscPath(process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows');
      if (!compiler) { fail('Windows C# compiler is unavailable'); return false; }
      fs.mkdirSync(input.cacheDirectory, { recursive: true });
      execFileSync(compiler, ['/nologo', '/optimize+', `/out:${executable}`, input.sourcePath], {
        timeout: 15_000, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
      fs.writeFileSync(stampFile, stamp, 'utf8');
      return true;
    } catch (error) {
      fail('Native window control could not compile: ' + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  }
  function registerLine(slot: ControlRegistration): string {
    const { hit, restore } = slot;
    return ['R', slot.id, slot.hwnd, slot.pid, slot.processStartTicks, slot.ownerHwnd,
      hit.x, hit.y, hit.width, hit.height,
      restore.x, restore.y, restore.width, restore.height,
      Buffer.from(slot.windowClass, 'utf8').toString('base64')].join('|');
  }
  function scheduleRestart(): void {
    if (stopped || retryTimer) return;
    const now = Date.now();
    restartTimes = restartTimes.filter((time) => now - time < RESTART_WINDOW_MS);
    if (restartTimes.length >= RESTART_LIMIT) {
      fail('Native window control stopped repeatedly; restart Papers to retry');
      return;
    }
    restartTimes.push(now);
    retryTimer = setTimeout(() => { retryTimer = null; start(); }, 500 * restartTimes.length);
  }
  function start(): void {
    if (stopped || !compile()) return;
    const instance = ++generation;
    child = spawn(executable, [telemetryFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child.once('error', (error) => {
      if (instance !== generation) return;
      fail('Native window control failed: ' + error.message);
      scheduleRestart();
    });
    child.once('exit', (code) => {
      if (instance !== generation || stopped) return;
      fail('Native window control exited (' + String(code) + ')');
      scheduleRestart();
    });
    if (child.stdout) {
        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', (line) => {
          const parts = line.split('|');
          if (parts[0] === 'READY') {
            ready = true;
            for (const slot of registrations.values()) send(registerLine(slot));
          } else if (parts[0] === 'ACK' && parts.length === 3) {
            const id = Number(parts[1]);
            if (parts[2] !== '1' && registrations.has(id)) input.onUnavailable('Native window control rejected a window binding');
            pending.get(id)?.(parts[2] === '1');
            pending.delete(id);
          } else if (parts[0] === 'EVENT' && parts.length === 8) {
            const operation = parts[3];
            if (operation !== 'minimize' && operation !== 'restore' && operation !== 'foreground') return;
            const event: ControlEvent = {
              seq: Number(parts[1]), id: Number(parts[2]), operation,
              inputQpc: parts[4]!, dispatchQpc: parts[5]!, confirmedQpc: parts[6]!,
              result: parts[7]!,
            };
            for (const listener of listeners) listener(event);
          } else if (parts[0] === 'SHIFT' && parts.length === 2
            && (parts[1] === '0' || parts[1] === '1')) {
            for (const listener of shiftListeners) listener(parts[1] === '1');
          }
        });
    }
  }
  start();
  return {
    get ready() { return ready; },
    register(slot) {
      registrations.set(slot.id, slot);
      const line = registerLine(slot);
      if (!send(line)) {
        noteRefusal('not-sent: broker not ready');
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        pending.get(slot.id)?.(false);
        pending.set(slot.id, resolve);
        setTimeout(() => {
          if (pending.get(slot.id) === resolve) {
            pending.delete(slot.id);
            // The broker answers every registration, accepted or refused, and logs
            // which. Silence means it never parsed the line - and "refused" versus
            // "never seen" are different faults with different repairs.
            noteRefusal('no-answer: sent ' + line.length + ' bytes, no ACK within 5s');
            resolve(false);
          }
        }, 5000);
      });
    },
    clear(id) {
      registrations.delete(id);
      pending.get(id)?.(false);
      pending.delete(id);
      send('C|' + id);
    },
    group(actions) {
      if (actions.length === 0 || actions.length > 32
        || actions.some(({ id }) => !Number.isSafeInteger(id) || id <= 0)) return false;
      return send('G|' + actions.map(({ id, operation }) => id + ':' + operation).join(','));
    },
    onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onShift(listener) { shiftListeners.add(listener); return () => { shiftListeners.delete(listener); }; },
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      send('Q');
      child?.stdin?.end();
      child?.kill();
      fail('Native window control stopped');
    },
  };
}

export function resolveWindowControlSourcePath(input: { appPath: string; resourcesPath: string; packaged: boolean }): string {
  return path.join(input.packaged ? input.resourcesPath : path.join(input.appPath, 'resources'), 'native', SOURCE);
}
