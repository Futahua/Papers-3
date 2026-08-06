/**
 * JSON-lines transport for the window-capability seam (Assignment 011/011R).
 *
 * Frames the typed WindowRequestMessage/WindowResponseMessage protocol as
 * UTF-8 JSON followed by exactly one LF. Everything runs over narrow
 * injected stream-like interfaces, so this proof needs no child process,
 * socket or pipe: FakeSink/FakeSource drive every regression deterministically.
 *
 * Policies (documented, tested):
 * - Malformed lines (empty, invalid JSON, or failing the 010R deep schema
 *   gate) are IGNORED: they satisfy no request and never expose an untyped
 *   payload, and they do not kill the session.
 * - maxLineBytes is the UTF-8 JSON PAYLOAD byte cap, excluding the LF/CRLF
 *   delimiter, inbound AND outbound. A trailing CR is treated as the
 *   possible CRLF delimiter and not counted; if the following byte is not
 *   LF the CR becomes payload and the cap is re-checked (fail closed).
 *   maxReceiveBufferBytes caps the unfinished receive buffer (raw bytes).
 *   Exceeding either is TERMINAL. The outbound cap rejects only that send.
 * - Outbound sends serialize FIFO: once a write returns false, no further
 *   write runs until the sink drains; invocation order is preserved.
 * - Every in-flight send phase (write acceptance AND drain) races against
 *   one shared terminal signal with a preserved cause, so a never-settling
 *   async write is promptly rejected by EOF, read/write error or explicit
 *   close.
 * - EVERY terminal, including explicit close, notifies observers once.
 *   The supervisor's clean stop stays `stopped` because it enters
 *   `stopping` before calling close().
 * - Endpoints close at most once; no later messages are emitted; repeated
 *   terminal events settle/notify nothing twice.
 */

import {
  parseWindowResponse,
  type WindowRequestMessage,
  type WindowResponseMessage,
  type WindowTransport,
} from './windowCapabilityTypes';

/** Narrow writable endpoint. `write` returns false (or a promise resolving
 * to false) to signal backpressure; the transport waits for onDrain before
 * invoking the next write. */
export interface TransportSink {
  write(bytes: Uint8Array): boolean | Promise<boolean>;
  onDrain(callback: () => void): void;
  end(): void | Promise<void>;
}

/** Narrow readable endpoint. Chunks arrive in arbitrary boundaries; onEnd
 * reports EOF (no error) or a read failure exactly once. */
export interface TransportSource {
  onChunk(callback: (chunk: Uint8Array) => void): void;
  onEnd(callback: (error?: Error) => void): void;
  end(): void | Promise<void>;
}

export const DEFAULT_MAX_LINE_BYTES = 64 * 1024;
export const DEFAULT_MAX_RECEIVE_BUFFER_BYTES = 256 * 1024;

const LF = 0x0a;
const CR = 0x0d;

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function createJsonLineTransport({
  sink,
  source,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  maxReceiveBufferBytes = DEFAULT_MAX_RECEIVE_BUFFER_BYTES,
}: {
  sink: TransportSink;
  source: TransportSource;
  maxLineBytes?: number;
  maxReceiveBufferBytes?: number;
}): WindowTransport {
  // Validate BEFORE subscribing to any endpoint: an invalid configuration
  // throws without a half-created transport.
  assertPositiveSafeInteger(maxLineBytes, 'maxLineBytes');
  assertPositiveSafeInteger(maxReceiveBufferBytes, 'maxReceiveBufferBytes');
  if (maxReceiveBufferBytes < maxLineBytes) {
    throw new Error('maxReceiveBufferBytes must be at least maxLineBytes');
  }

  let terminated = false;
  let endpointsClosed = false;
  let terminalReason: Error | undefined;
  let messageHandler: ((raw: unknown) => void) | null = null;
  const terminalObservers = new Set<(error?: Error) => void>();

  interface DrainWaiter {
    resolve: () => void;
    reject: (error: Error) => void;
  }
  const drainWaiters = new Set<DrainWaiter>();

  // Inbound framing state. contentBytes excludes a trailing CR while it may
  // be the CRLF delimiter; rawBytes counts everything since the last LF.
  const lineBytes: number[] = [];
  let contentBytes = 0;
  let rawBytes = 0;
  let pendingCR = false;

  function closeEndpointsOnce(): void {
    if (endpointsClosed) return;
    endpointsClosed = true;
    void Promise.resolve(sink.end()).catch(() => undefined);
    void Promise.resolve(source.end()).catch(() => undefined);
  }

  /** Terminal path: idempotent. Records the cause, rejects every drain
   * waiter, closes the endpoints once, and notifies every observer once. */
  function failClosed(error?: Error): void {
    if (terminated) return;
    terminated = true;
    terminalReason = error ?? new Error('transport terminated');
    for (const waiter of [...drainWaiters]) {
      drainWaiters.delete(waiter);
      waiter.reject(terminalReason);
    }
    closeEndpointsOnce();
    for (const observer of [...terminalObservers]) {
      try {
        observer(terminalReason);
      } catch {
        // A terminal observer must not prevent the others from running.
      }
    }
  }

  function resetLine(): void {
    lineBytes.length = 0;
    contentBytes = 0;
    rawBytes = 0;
    pendingCR = false;
  }

  function handleLine(line: string): void {
    if (line.length === 0) return; // empty line policy: ignored
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // malformed JSON policy: ignored
    }
    // Deep schema gate: malformed payloads are ignored, never delivered.
    const response = parseWindowResponse(parsed);
    if (!response) return;
    messageHandler?.(response as WindowResponseMessage);
  }

  function onChunk(chunk: Uint8Array): void {
    if (terminated) return;
    for (let i = 0; i < chunk.byteLength; i += 1) {
      const byte = chunk[i]!;
      if (byte === LF) {
        if (contentBytes > maxLineBytes) {
          failClosed(new Error(`inbound line payload exceeds the ${maxLineBytes}-byte limit`));
          return;
        }
        let line = new TextDecoder().decode(Uint8Array.from(lineBytes));
        if (pendingCR) line = line.slice(0, -1); // strip the CRLF delimiter
        resetLine();
        handleLine(line);
        if (terminated) return;
      } else if (byte === CR) {
        // Possible CRLF delimiter: do not count it as payload yet.
        if (pendingCR) {
          // A second CR proves the previous CR was payload — recheck the
          // line cap immediately, fail-closed on the line limit.
          contentBytes += 1;
          if (contentBytes > maxLineBytes) {
            failClosed(new Error(`inbound line payload exceeds the ${maxLineBytes}-byte limit`));
            return;
          }
        }
        pendingCR = true;
        lineBytes.push(byte);
      } else {
        if (pendingCR) {
          // The earlier CR was payload, not a delimiter.
          contentBytes += 1;
          pendingCR = false;
        }
        lineBytes.push(byte);
        contentBytes += 1;
        if (contentBytes > maxLineBytes) {
          failClosed(new Error(`inbound line payload exceeds the ${maxLineBytes}-byte limit`));
          return;
        }
      }
      rawBytes += 1;
      if (rawBytes > maxReceiveBufferBytes) {
        failClosed(new Error(`unfinished receive buffer exceeds the ${maxReceiveBufferBytes}-byte limit`));
        return;
      }
    }
  }

  function onSourceEnd(error?: Error): void {
    failClosed(error);
  }

  function subscribeEndpoints(): void {
    sink.onDrain(() => {
      for (const waiter of [...drainWaiters]) {
        drainWaiters.delete(waiter);
        waiter.resolve();
      }
    });
    source.onChunk(onChunk);
    source.onEnd(onSourceEnd);
  }
  subscribeEndpoints();

  /** Serialized FIFO outbound chain: a send never writes before the
   * previous send has finished (including its drain wait). */
  let sendChain: Promise<void> = Promise.resolve();

  function doSend(message: WindowRequestMessage): Promise<void> {
    if (terminated) {
      return Promise.reject(terminalReason ?? new Error('transport is closed'));
    }
    let payload: Uint8Array;
    try {
      payload = new TextEncoder().encode(JSON.stringify(message));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('outbound serialization failed'));
    }
    // maxLineBytes covers the JSON payload only; the appended LF makes the
    // frame exactly one byte larger.
    if (payload.byteLength > maxLineBytes) {
      return Promise.reject(new Error(`outbound line payload exceeds the ${maxLineBytes}-byte limit`));
    }
    const frame = new Uint8Array(payload.byteLength + 1);
    frame.set(payload, 0);
    frame[payload.byteLength] = LF;

    return (async () => {
      // Race the write acceptance against the terminal signal so a
      // never-settling async write cannot strand the send.
      const accepted = await new Promise<boolean>((resolve, reject) => {
        const onTerminal = (error?: Error) => {
          reject(error ?? new Error('transport closed while writing'));
        };
        terminalObservers.add(onTerminal);
        if (terminated) {
          terminalObservers.delete(onTerminal);
          reject(terminalReason ?? new Error('transport is closed'));
          return;
        }
        let writeResult: boolean | Promise<boolean>;
        try {
          writeResult = sink.write(frame);
        } catch (error) {
          // Synchronous write failure: terminal, and this send rejects.
          terminalObservers.delete(onTerminal);
          failClosed(error instanceof Error ? error : new Error('sink write failed'));
          reject(error instanceof Error ? error : new Error('sink write failed'));
          return;
        }
        void Promise.resolve(writeResult).then(
          (value) => {
            terminalObservers.delete(onTerminal);
            resolve(value);
          },
          (error) => {
            terminalObservers.delete(onTerminal);
            failClosed(error instanceof Error ? error : new Error('sink write failed'));
            reject(error instanceof Error ? error : new Error('sink write failed'));
          },
        );
      });
      if (accepted === false) {
        // Backpressure: resolve only once the sink drains; terminal rejects.
        await new Promise<void>((resolve, reject) => {
          const waiter: DrainWaiter = { resolve, reject };
          drainWaiters.add(waiter);
          if (terminated) {
            drainWaiters.delete(waiter);
            reject(terminalReason ?? new Error('transport closed while waiting for drain'));
          }
        });
      }
    })();
  }

  function send(message: WindowRequestMessage): Promise<void> {
    const run = sendChain.then(() => doSend(message));
    sendChain = run.catch(() => undefined);
    return run;
  }

  return {
    send,
    onMessage(callback: (raw: unknown) => void): void {
      messageHandler = callback;
    },
    onTerminal(callback: (error?: Error) => void): void {
      terminalObservers.add(callback);
      // Late registration after termination receives the preserved cause
      // synchronously, exactly once.
      if (terminated) callback(terminalReason);
    },
    async close(): Promise<void> {
      failClosed(new Error('transport closed'));
    },
  };
}
