import { execFileSync, spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const HOVER_INPUT_BRIDGE_SOURCE_FILE = 'hover-input-bridge.cs';
export const HOVER_INPUT_BRIDGE_EXECUTABLE = 'papers-hover-input-bridge.exe';

export interface HoverInputBridge {
  registerWidget(senderId: number, nativeHandle: Buffer): void;
  setPolicy(senderId: number, enabled: boolean, blockedBindings: readonly string[]): Promise<void>;
  setCaptureOpening(senderId: number): Promise<void>;
  removeWidget(senderId: number): void;
  setOverlayOpen(open: boolean): Promise<void>;
  close(): void;
}

export interface HoverInputBridgeOptions {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  spawn?: typeof spawnProcess;
  onAltQ: () => void;
  onAltQRelease?: () => void;
  onCaptured: (senderId: number, captureId: string, text: string) => void | Promise<void>;
  onAppended?: (senderId: number, captureId: string, text: string) => void | Promise<void>;
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
  let overlayGenerationSequence = 0;
  let policyRequestSequence = 0;
  const policyAcks = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  let overlayReady: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  const openingReady = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const send = (record: string): boolean => {
    if (closed || child.stdin.destroyed) return false;
    try { child.stdin.write(`${record}\n`); return true; }
    catch { options.onError?.('native hover-input helper disconnected'); return false; }
  };
  const rejectPending = (error: Error): void => {
    if (overlayReady) {
      clearTimeout(overlayReady.timer);
      overlayReady.reject(error);
      overlayReady = null;
    }
    for (const pending of openingReady.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    openingReady.clear();
    for (const pending of policyAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    policyAcks.clear();
  };
  const abortNativeHandoff = (): void => {
    if (overlayReady) {
      clearTimeout(overlayReady.timer);
      overlayReady.reject(new Error('Quick Run input delivery failed'));
      overlayReady = null;
    }
    send('OVERLAY\t0');
  };
  const trackNativeInput = (senderId: number, captureId: string, text: string, callback: HoverInputBridgeOptions['onCaptured']): void => {
    Promise.resolve().then(() => callback(senderId, captureId, text)).then(() => {
      send(`ACK\t${captureId}`);
    }).catch((error: unknown) => {
      options.onError?.(`native hover input was not delivered: ${error instanceof Error ? error.message : String(error)}`);
      send(`ACK\t${captureId}`);
      abortNativeHandoff();
    });
  };
  const trackNativeAppend = (senderId: number, captureId: string, text: string): void => {
    Promise.resolve().then(() => options.onAppended?.(senderId, captureId, text)).then(() => {
      send(`ACK\t${captureId}`);
    }).catch((error: unknown) => {
      options.onError?.(`native hover input append was not delivered: ${error instanceof Error ? error.message : String(error)}`);
      send(`ACK\t${captureId}`);
      abortNativeHandoff();
    });
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
      else if (parts[0] === 'OPENING_READY' && parts.length === 2) {
        const senderId = Number(parts[1]);
        const pending = openingReady.get(senderId);
        if (pending) {
          clearTimeout(pending.timer);
          openingReady.delete(senderId);
          pending.resolve();
        }
      } else if (parts[0] === 'OVERLAY_READY' && parts.length === 2) {
        const generation = Number(parts[1]);
        if (overlayReady && generation === overlayGenerationSequence) {
          clearTimeout(overlayReady.timer);
          overlayReady.resolve();
          overlayReady = null;
        }
      } else if (parts[0] === 'POLICY_ACK' && parts.length === 4 && /^\d+$/.test(parts[1] ?? '')) {
        const requestId = Number(parts[1]);
        const pending = policyAcks.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          policyAcks.delete(requestId);
          if (parts[2] === 'OK' && parts[3] === '-') pending.resolve();
          else pending.reject(new Error(`native helper rejected hover-input policy: ${parts[3] ?? 'unknown error'}`));
        }
      }
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
            trackNativeInput(senderId, captureId, text, options.onCaptured);
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
            && [...text].length === 1 && Buffer.byteLength(text, 'utf8') <= 8) trackNativeAppend(senderId, captureId, text);
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
    rejectPending(new Error('native hover-input helper disconnected'));
    if (code !== 0) options.onError?.(`native hover-input helper exited (${code ?? 'unknown'})`);
    options.onAltQRelease?.();
  });

  return {
    registerWidget(senderId, nativeHandle) {
      send(`WIDGET\t${senderId}\t${nativeHandleValue(nativeHandle)}`);
    },
    setPolicy(senderId, enabled, blockedBindings) {
      const blocked = validBlockedBindings(blockedBindings);
      if (closed) return Promise.reject(new Error('native hover-input helper is closed'));
      if (policyAcks.size >= 256) return Promise.reject(new Error('too many native hover-input policy requests are pending'));
      const requestId = ++policyRequestSequence;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          policyAcks.delete(requestId);
          reject(new Error('native helper did not acknowledge the hover-input policy'));
        }, 1500);
        policyAcks.set(requestId, { resolve, reject, timer });
        const record = `POLICY\t${requestId}\t${senderId}\t${enabled ? '1' : '0'}\t${Buffer.from(blocked.join('\n'), 'utf8').toString('base64')}`;
        if (!send(record)) {
          clearTimeout(timer);
          policyAcks.delete(requestId);
          reject(new Error('native hover-input helper is unavailable'));
        }
      });
    },
    setCaptureOpening(senderId) {
      if (closed) return Promise.reject(new Error('native hover-input helper is closed'));
      if (openingReady.has(senderId)) return Promise.reject(new Error('widget opening is already pending'));
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          openingReady.delete(senderId);
          reject(new Error('native helper did not acknowledge widget opening'));
        }, 3000);
        openingReady.set(senderId, { resolve, reject, timer });
        send(`OPENING\t${senderId}`);
      });
    },
    removeWidget(senderId) { send(`REMOVE\t${senderId}`); },
    setOverlayOpen(open) {
      if (!open) {
        if (overlayReady) {
          clearTimeout(overlayReady.timer);
          overlayReady.reject(new Error('overlay handoff was cancelled'));
          overlayReady = null;
        }
        send('OVERLAY\t0');
        return Promise.resolve();
      }
      if (closed) return Promise.reject(new Error('native hover-input helper is closed'));
      if (overlayReady) return overlayReady.promise;
      const generation = ++overlayGenerationSequence;
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
      const timer = setTimeout(() => {
        if (overlayReady?.promise !== promise) return;
        overlayReady = null;
        reject(new Error('native helper did not acknowledge the overlay handoff'));
      }, 5000);
      overlayReady = { promise, resolve, reject, timer };
      send(`OVERLAY\t1\t${generation}`);
      return promise;
    },
    close() {
      if (closed) return;
      send('QUIT');
      setTimeout(() => { if (!closed) child.kill(); }, 1500).unref();
    },
  };
}
