/**
 * Injected helper-process ownership adapter (Assignment 012/012R).
 *
 * Wraps ONE injected child-like process and exposes the already accepted
 * WindowTransport — never the raw child or raw stream endpoints. Launch
 * policy stays outside this module: the public API accepts only a
 * zero-argument `createProcess()` factory plus byte-limit sizes; no
 * executable path, script, argument, environment map or working directory
 * can enter here.
 *
 * Ownership contract:
 * - All limits are validated BEFORE createProcess or any subscription:
 *   maxLineBytes/maxReceiveBufferBytes are positive safe integers,
 *   maxStderrBytes is a NON-NEGATIVE safe integer (0 retains no
 *   diagnostic bytes but still marks truncation when input arrives).
 * - Factory throw, missing required stdio, or stream subscription throw
 *   fails construction closed, best-effort ends stdin/stdout/stderr and
 *   terminates any partial child at most once, and exposes no transport.
 * - stdout EOF/error, stdin write failure, an INDEPENDENT stdin error
 *   (out-of-band onError), child `error` and child `exit` are ONE shared
 *   terminal event through the JSON-line transport's idempotent gate:
 *   the first cause is retained; duplicate/reordered signals notify once
 *   and close/terminate endpoints + process at most once.
 * - Explicit transport close ends stdin, ends stdout AND stderr, and
 *   requests graceful child termination once (coherent 011 policy).
 *   stderr chunks after terminal are ignored.
 * - stderr is consumed only as a bounded diagnostic (maxStderrBytes of
 *   encoded bytes, deterministic truncation): never parsed as protocol,
 *   never delivered to onMessage, never unbounded.
 */

import {
  createJsonLineTransport,
  type TransportSink,
  type TransportSource,
} from './jsonLineTransport';
import type { WindowTransport } from './windowCapabilityTypes';

/** The child-side stdin seam: a JSON-line sink plus a narrow out-of-band
 * error subscription (an independent writable error, not a write failure).
 * The generic TransportSink accepted by createJsonLineTransport is NOT
 * widened. */
export interface ChildStdin extends TransportSink {
  onError(callback: (error: Error) => void): void;
}

/** Narrow child-like process contract. The fake tests implement this; a
 * later composition root maps a real child_process onto it. No raw Node
 * child/stream types appear in this module's API. */
export interface ChildLikeProcess {
  stdin: ChildStdin;
  stdout: TransportSource;
  stderr: TransportSource;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
  onError(callback: (error: Error) => void): void;
  kill(): void;
}

export const DEFAULT_MAX_STDERR_BYTES = 4 * 1024;

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function isChildLike(value: unknown): value is ChildLikeProcess {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<ChildLikeProcess>;
  const stdin = candidate.stdin as Partial<ChildStdin> | undefined;
  const stdout = candidate.stdout as Partial<TransportSource> | undefined;
  const stderr = candidate.stderr as Partial<TransportSource> | undefined;
  return Boolean(
    stdin
    && isCallable(stdin.write) && isCallable(stdin.onDrain)
    && isCallable(stdin.onError) && isCallable(stdin.end)
    && stdout
    && isCallable(stdout.onChunk) && isCallable(stdout.onEnd) && isCallable(stdout.end)
    && stderr
    && isCallable(stderr.onChunk) && isCallable(stderr.onEnd) && isCallable(stderr.end)
    && isCallable(candidate.onExit) && isCallable(candidate.onError) && isCallable(candidate.kill),
  );
}

export interface HelperProcessTransportOptions {
  /** Zero-argument factory returning a child-like process. */
  createProcess: () => ChildLikeProcess;
  maxLineBytes?: number;
  maxReceiveBufferBytes?: number;
  /** stderr diagnostic byte cap (encoded bytes); 0 retains nothing. */
  maxStderrBytes?: number;
}

export function createHelperProcessTransport({
  createProcess,
  maxLineBytes,
  maxReceiveBufferBytes,
  maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
}: HelperProcessTransportOptions): WindowTransport {
  // Validate every limit BEFORE createProcess, subscriptions, ends or
  // kills: an invalid configuration exposes no transport and touches
  // nothing.
  assertPositiveSafeInteger(maxLineBytes ?? 64 * 1024, 'maxLineBytes');
  assertPositiveSafeInteger(maxReceiveBufferBytes ?? 256 * 1024, 'maxReceiveBufferBytes');
  assertNonNegativeSafeInteger(maxStderrBytes, 'maxStderrBytes');
  if ((maxReceiveBufferBytes ?? 256 * 1024) < (maxLineBytes ?? 64 * 1024)) {
    throw new Error('maxReceiveBufferBytes must be at least maxLineBytes');
  }

  let child: ChildLikeProcess;
  try {
    child = createProcess();
  } catch (error) {
    // The factory never produced a child: nothing to terminate.
    throw error;
  }
  if (!isChildLike(child)) {
    // Missing required stdio: end every AVAILABLE valid endpoint
    // best-effort (robust when the partial shape itself lacks an end
    // method) and terminate once; expose nothing.
    const partial = child as unknown as Record<string, unknown>;
    for (const streamKey of ['stdin', 'stdout', 'stderr'] as const) {
      const stream = partial[streamKey];
      if (stream !== null && typeof stream === 'object') {
        const end = (stream as Record<string, unknown>)['end'];
        if (typeof end === 'function') {
          try {
            void Promise.resolve((end as () => void | Promise<void>).call(stream)).catch(() => undefined);
          } catch {
            // best effort
          }
        }
      }
    }
    if (typeof partial['kill'] === 'function') {
      try {
        (partial['kill'] as () => void)();
      } catch {
        // best effort
      }
    }
    throw new Error('helper process is missing required stdio');
  }

  let childTerminated = false;
  let readablesEnded = false;

  function terminateChildOnce(): void {
    if (childTerminated) return;
    childTerminated = true;
    try {
      child.kill();
    } catch {
      // best effort
    }
  }

  /** Ends stdin, stdout AND stderr at most once each plus the child at
   * most once. End failures are best-effort and never duplicate a
   * termination or replace the first terminal cause. */
  function safeEnd(end: () => void | Promise<void>): void {
    try {
      void Promise.resolve(end()).catch(() => undefined);
    } catch {
      // best effort
    }
  }
  function endOwnershipOnce(): void {
    if (readablesEnded) return;
    readablesEnded = true;
    safeEnd(() => child.stdin.end());
    safeEnd(() => child.stdout.end());
    safeEnd(() => child.stderr.end());
    terminateChildOnce();
  }

  // stdin adapts directly as the JSON-line sink; stdout is its source.
  const stdinSink: TransportSink = {
    write: (bytes) => child.stdin.write(bytes),
    onDrain: (callback) => child.stdin.onDrain(callback),
    end: () => endOwnershipOnce(),
  };

  let transport: WindowTransport;
  try {
    const stdoutSource: TransportSource = {
      onChunk: (callback) => child.stdout.onChunk(callback),
      onEnd: (callback) => {
        // ONE terminal path: stdout EOF/error, an independent stdin error,
        // child error and child exit all feed the transport's single
        // idempotent gate; the first cause wins and duplicates are no-ops.
        child.stdout.onEnd((error) => callback(error));
        child.stdin.onError((error) => callback(error));
        child.onError((error) => callback(error));
        child.onExit((code, signal) => {
          const diagnostic = stderrDiagnostic();
          const cause = new Error(
            `helper exited (code ${code === null ? '?' : code}${signal ? `, ${signal}` : ''})`
            + (diagnostic ? `: ${diagnostic}` : ''),
          );
          callback(cause);
        });
      },
      end: () => endOwnershipOnce(),
    };

    // Bounded stderr diagnostics: encoded bytes up to the cap, truncated
    // deterministically, ignored after terminal, never parsed as protocol,
    // never delivered to onMessage. Only the truncated text is preserved
    // for lifecycle error causes (appended to the child-exit cause).
    const stderrBytes: number[] = [];
    let stderrByteCount = 0;
    let stderrTruncated = false;
    const stderrDiagnostic = (): string => {
      const text = new TextDecoder().decode(Uint8Array.from(stderrBytes));
      return stderrTruncated ? `${text}\u2026` : text;
    };
    child.stderr.onChunk((chunk) => {
      if (stderrTruncated || readablesEnded) return; // no data after terminal
      for (let i = 0; i < chunk.byteLength; i += 1) {
        if (stderrByteCount >= maxStderrBytes) {
          stderrTruncated = true;
          break;
        }
        stderrBytes.push(chunk[i]!);
        stderrByteCount += 1;
      }
    });

    transport = createJsonLineTransport({
      sink: stdinSink,
      source: stdoutSource,
      maxLineBytes,
      maxReceiveBufferBytes,
    });
  } catch (error) {
    endOwnershipOnce();
    throw error;
  }

  return {
    send: transport.send,
    onMessage: transport.onMessage,
    onTerminal: transport.onTerminal,
    close: transport.close,
  };
}
