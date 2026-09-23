import { execFileSync, spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const HOVER_INPUT_BRIDGE_SOURCE_FILE = 'hover-input-bridge.cs';
export const HOVER_INPUT_BRIDGE_EXECUTABLE = 'papers-hover-input-bridge.exe';

export interface HoverInputBridge {
  registerWidget(senderId: number, nativeHandle: Buffer): void;
  setPolicy(senderId: number, enabled: boolean, blockedBindings: readonly string[]): void;
  setCaptureOpening(senderId: number): void;
  removeWidget(senderId: number): void;
  setFollowTarget(senderId: number, nativeHandle: Buffer): void;
  setOverlayOpen(open: boolean): void;
  close(): void;
}

export interface HoverInputBridgeOptions {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  spawn?: typeof spawnProcess;
  onAltQ: () => void;
  onAltQRelease?: () => void;
  onCaptured: (senderId: number, captureId: string, text: string) => void;
  onAppended?: (senderId: number, captureId: string, text: string) => void;
  onError?: (message: string) => void;
}

export function resolveHoverInputBridgeSourcePath(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): string {
  const directory = input.packaged
    ? path.join(input.resourcesPath, 'native')
    : path.join(input.appPath, 'resources', 'native');
  return path.join(directory, HOVER_INPUT_BRIDGE_SOURCE_FILE);
}

function nativeHandleValue(buffer: Buffer): string {
  if (!Buffer.isBuffer(buffer) || (buffer.length !== 4 && buffer.length !== 8)) throw new Error('native widget handle is malformed');
  const value = buffer.length === 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
  if (value <= 0n) throw new Error('native widget handle is malformed');
  return value.toString(10);
}

function validBlockedBindings(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 256) throw new Error('hover capture binding policy is malformed');
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !/^(?:Shift\+)?[^+\t\r\n]+$/.test(value)) {
      throw new Error('hover capture binding policy is malformed');
    }
    result.push(value);
  }
  return [...new Set(result)];
}

/**
 * Windows-only persistent host helper. Its native hook suppresses only a
 * proven printable key inside a live, visible, topmost registered widget.
 * Everything outside that gate is passed to the foreground application.
 */
export function createHoverInputBridge(options: HoverInputBridgeOptions): HoverInputBridge | null {
  if (process.platform !== 'win32') return null;
  let source: Buffer;
  try { source = fs.readFileSync(options.sourcePath); }
  catch { options.onError?.('native hover-input helper source is missing'); return null; }

  const executable = path.join(options.cacheDirectory, HOVER_INPUT_BRIDGE_EXECUTABLE);
  const stamp = crypto.createHash('sha256').update(source).digest('hex');
  const stampPath = `${executable}.sha256`;
  let ready = false;
  try { ready = fs.readFileSync(stampPath, 'utf8') === stamp && fs.statSync(executable).isFile(); }
  catch { ready = false; }
  if (!ready) {
    const compiler = options.compilerPath
      ?? path.join(process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    try {
      fs.mkdirSync(options.cacheDirectory, { recursive: true });
      execFileSync(compiler, ['/nologo', '/optimize+', `/out:${executable}`, options.sourcePath], {
        stdio: ['ignore', 'ignore', 'pipe'], timeout: 15_000, windowsHide: true,
      });
      fs.writeFileSync(stampPath, stamp, 'utf8');
    } catch (error) {
      const detail = error && typeof error === 'object' && 'stderr' in error && Buffer.isBuffer((error as { stderr?: Buffer }).stderr)
        ? (error as { stderr: Buffer }).stderr.toString('utf8').trim().slice(0, 300)
        : error instanceof Error ? error.message : String(error);
      options.onError?.(`native hover-input helper could not be compiled: ${detail}`);
      return null;
    }
  }

  const child: ChildProcessWithoutNullStreams = (options.spawn ?? spawnProcess)(executable, [], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let closed = false;
  let buffered = '';
  const send = (record: string): void => {
    if (closed || child.stdin.destroyed) return;
    try { child.stdin.write(`${record}\n`); }
    catch { options.onError?.('native hover-input helper disconnected'); }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    if (buffered.length > 8192) { buffered = ''; options.onError?.('native hover-input helper sent an oversized record'); return; }
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).replace(/\r$/, '');
      buffered = buffered.slice(newline + 1);
      const parts = line.split('\t');
      if (parts[0] === 'ALTQ') options.onAltQ();
      else if (parts[0] === 'ALTQ_RELEASE') options.onAltQRelease?.();
      else if (parts[0] === 'ERROR') options.onError?.(`native hover-input helper: ${parts[1] ?? 'unknown error'}`);
      else if (parts[0] === 'CAPTURE' && parts.length === 4) {
        const senderId = Number(parts[1]);
        const captureId = parts[2];
        const encoded = parts[3];
        try {
          if (typeof encoded !== 'string' || typeof captureId !== 'string') continue;
          const text = Buffer.from(encoded, 'base64').toString('utf8');
          if (Number.isSafeInteger(senderId) && senderId > 0 && /^\d{1,20}$/.test(captureId)
            && [...text].length === 1 && Buffer.byteLength(text, 'utf8') <= 8) {
            options.onCaptured(senderId, captureId, text);
          }
        } catch { /* malformed native event fails closed */ }
      } else if (parts[0] === 'APPEND' && parts.length === 4) {
        const senderId = Number(parts[1]);
        const captureId = parts[2];
        const encoded = parts[3];
        try {
          if (typeof encoded !== 'string' || typeof captureId !== 'string') continue;
          const text = Buffer.from(encoded, 'base64').toString('utf8');
          if (Number.isSafeInteger(senderId) && senderId > 0 && /^\d{1,20}$/.test(captureId)
            && [...text].length === 1 && Buffer.byteLength(text, 'utf8') <= 8) options.onAppended?.(senderId, captureId, text);
        } catch { /* malformed native event fails closed */ }
      } else if (parts[0] === 'READY' && parts[1] === '0') {
        options.onError?.('Alt+Q is already registered by another application; Papers could not claim it');
      }
      newline = buffered.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => options.onError?.(chunk.trim().slice(0, 300)));
  child.once('error', () => options.onError?.('native hover-input helper failed to start'));
  child.once('exit', (code) => {
    closed = true;
    if (code !== 0) options.onError?.(`native hover-input helper exited (${code ?? 'unknown'})`);
    options.onAltQRelease?.();
  });

  return {
    registerWidget(senderId, nativeHandle) {
      send(`WIDGET\t${senderId}\t${nativeHandleValue(nativeHandle)}`);
    },
    setPolicy(senderId, enabled, blockedBindings) {
      const blocked = validBlockedBindings(blockedBindings);
      send(`POLICY\t${senderId}\t${enabled ? '1' : '0'}\t${Buffer.from(blocked.join('\n'), 'utf8').toString('base64')}`);
    },
    setCaptureOpening(senderId) { send(`OPENING\t${senderId}`); },
    removeWidget(senderId) { send(`REMOVE\t${senderId}`); },
    setFollowTarget(senderId, nativeHandle) {
      send(`TARGET\t${senderId}\t${nativeHandleValue(nativeHandle)}`);
    },
    setOverlayOpen(open) { send(`OVERLAY\t${open ? '1' : '0'}`); },
    close() {
      if (closed) return;
      send('QUIT');
      setTimeout(() => { if (!closed) child.kill(); }, 1500).unref();
    },
  };
}
