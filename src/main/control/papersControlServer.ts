import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

import {
  controlEventNameSchema,
  controlRequestIdSchema,
  controlRequestSchema,
  dispatchPapersControl,
  PAPERS_CONTROL_PROTOCOL_VERSION,
  papersControlEventFrameSchema,
  papersControlCommands,
  type PapersControlDependencies,
  type PapersControlEventName,
  type VisualEventTarget,
} from './papersControlProtocol';
import {
  createPapersControlConfirmationBroker,
  type PapersControlConfirmationBroker,
} from './papersControlConfirmation';

/**
 * Per-FRAME limit, not a limit on everything the socket has ever delivered.
 * A stream may coalesce two perfectly legal requests into one delivery, and
 * rejecting their combined size would fail requests that are individually fine.
 */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * Newline framing, as a pure function of the delivered chunks.
 *
 * Extracted so the boundary rules can be tested with exact chunk sequences: a
 * real socket decides its own delivery boundaries, so a socket-level test
 * cannot reliably reproduce two requests arriving together, which is precisely
 * the case a cumulative size cap gets wrong.
 *
 * The cap is per frame. Everything already delivered is not one request, and
 * two individually legal requests must not be refused for the size of their
 * sum. An unterminated residual is capped separately, so a peer cannot grow the
 * buffer without ever sending a newline.
 */
export function createFrameReader({
  maxFrameBytes,
  onFrame,
  onOversize,
}: {
  maxFrameBytes: number;
  onFrame: (line: string) => void;
  onOversize: () => void;
}): { push(chunk: string): void } {
  let pending = '';
  let stopped = false;
  return {
    push(chunk: string): void {
      if (stopped) return;
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
        if (Buffer.byteLength(line) > maxFrameBytes) {
          stopped = true;
          onOversize();
          return;
        }
        onFrame(line);
      }
      if (Buffer.byteLength(pending) > maxFrameBytes) {
        stopped = true;
        onOversize();
      }
    },
  };
}

export interface PapersControlDescriptor {
  protocolVersion: number;
  pipe: string;
  token: string;
  pid: number;
}

export interface PapersControlServer {
  descriptor: PapersControlDescriptor;
  close(): Promise<void>;
}

export interface PapersControlEventHub {
  attach(socket: Socket): void;
  detach(socket: Socket): void;
  subscribe(socket: Socket, events: readonly PapersControlEventName[], visualTarget?: VisualEventTarget): void;
  publish(event: PapersControlEventName, payload: unknown): void;
}

interface EventSubscription {
  events: Set<PapersControlEventName>;
  visualTarget?: VisualEventTarget;
}

function isVisualEvent(event: PapersControlEventName): boolean {
  return event === 'visual.lifecycle' || event === 'visual.diagnostic';
}

function matchesVisualTarget(payload: unknown, target: VisualEventTarget): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  const record = payload as { target?: { windowId?: unknown; surfaceId?: unknown } };
  if (record.target?.windowId !== target.windowId) return false;
  return target.surfaceId === undefined || record.target.surfaceId === target.surfaceId;
}

/** Connection-local semantic event fan-out. The hub validates the complete
 * frame before sending it, so an accidental internal payload cannot widen the
 * authenticated boundary into URLs, roots, sender ids or native handles. */
export function createPapersControlEventHub(): PapersControlEventHub {
  const subscriptions = new Map<Socket, EventSubscription>();
  return {
    attach(socket) {
      subscriptions.set(socket, { events: new Set() });
    },
    detach(socket) {
      subscriptions.delete(socket);
    },
    subscribe(socket, events, visualTarget) {
      const current = subscriptions.get(socket);
      if (!current) return;
      if (events.some(isVisualEvent) && !visualTarget) return;
      for (const event of events) current.events.add(controlEventNameSchema.parse(event));
      if (events.some(isVisualEvent)) current.visualTarget = visualTarget;
    },
    publish(event, payload) {
      const frame = papersControlEventFrameSchema.parse({ type: 'event', event, payload });
      for (const [socket, subscription] of subscriptions) {
        if (!subscription.events.has(event)) continue;
        if (isVisualEvent(event) && (!subscription.visualTarget || !matchesVisualTarget(payload, subscription.visualTarget))) continue;
        if (isVisualEvent(event)) sendEvent(socket, frame);
        else send(socket, frame);
      }
    },
  };
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function send(socket: Socket, payload: unknown): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(payload)}\n`);
}

/** Live diagnostic events are intentionally drop-on-backpressure. The record's
 * sequence remains in the historical snapshot, so a client can detect a gap
 * and recover without an unbounded connection-local queue. */
function sendEvent(socket: Socket, payload: unknown): void {
  if (socket.destroyed || socket.writableNeedDrain) return;
  socket.write(`${JSON.stringify(payload)}\n`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Start an opt-in, process-local developer control endpoint. The descriptor
 * is the capability: it is written mode 0600, never logged, and removed when
 * Papers exits. No TCP port or renderer impersonation is involved. */
export async function startPapersControlServer({
  descriptorPath,
  dependencies,
  processId = process.pid,
  publishDescriptor,
  eventHub = createPapersControlEventHub(),
  confirmations = createPapersControlConfirmationBroker(),
}: {
  descriptorPath: string;
  dependencies: PapersControlDependencies;
  processId?: number;
  /** Seam for proving the startup rollback: a publication failure after
   * `listen` must leave nothing listening and nothing on disk. */
  publishDescriptor?: (temporaryPath: string, finalPath: string) => Promise<void>;
  eventHub?: PapersControlEventHub;
  confirmations?: PapersControlConfirmationBroker;
}): Promise<PapersControlServer> {
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(12).toString('hex');
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\papers-dev-${processId}-${nonce}`
    : `${descriptorPath}.${nonce}.sock`;

  /**
   * Every accepted socket, so shutdown can end them.
   *
   * `server.close()` stops accepting but waits for existing connections, so an
   * idle client that connects and sends nothing would hold Papers open
   * forever -- the before-quit handler awaits this close. Authentication
   * cannot help, because such a client never sends a token.
   */
  const sockets = new Set<Socket>();
  /**
   * Dispatches that have already started.
   *
   * The `closing` barrier stops new commands, but a command already past
   * admission -- window.create waiting on a renderer load, say -- would
   * otherwise keep running while detach, widget and capability teardown were
   * already under way, and finish by registering a window that expects
   * services which are going down. Shutdown is therefore a drain, not just a
   * gate: close() does not resolve until what started has settled.
   */
  const inFlight = new Set<Promise<void>>();
  let closing = false;

  const server: Server = createServer((socket) => {
    if (closing) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const connectionId = randomBytes(16).toString('hex');
    const requestControllers = new Set<AbortController>();
    eventHub.attach(socket);
    socket.setEncoding('utf8');
    // A peer vanishing mid-write must not raise an unhandled error.
    socket.on('error', () => undefined);
    socket.on('close', () => {
      for (const controller of requestControllers) controller.abort();
      requestControllers.clear();
      sockets.delete(socket);
      eventHub.detach(socket);
      confirmations.revokeConnection(connectionId);
    });

    const frames = createFrameReader({
      maxFrameBytes: MAX_FRAME_BYTES,
      onOversize: () => {
        send(socket, { id: null, ok: false, error: 'request too large' });
        socket.destroy();
      },
        onFrame: (line) => {
        const dispatched = (async () => {
          let requestId: string | number | null = null;
          const controller = new AbortController();
          requestControllers.add(controller);
          try {
            const raw = JSON.parse(line) as { id?: unknown };
            const rawId = controlRequestIdSchema.safeParse(raw.id);
            if (rawId.success) requestId = rawId.data;
            const request = controlRequestSchema.parse(raw);
            requestId = request.id;
            if (!sameSecret(request.token, token)) throw new Error('unauthorized');
            // Nothing may mutate after the shutdown barrier.
            if (closing) throw new Error('control server is shutting down');
            const result = await dispatchPapersControl(dependencies, request, {
              connectionId, confirmations, signal: controller.signal,
            });
            if (request.method === 'events.subscribe') {
              const subscription = papersControlCommands['events.subscribe'].input.parse(request.params ?? {});
              // Dispatch performs exact target validation first; only a
              // successful request may activate or replace this subscription.
              eventHub.subscribe(socket, subscription.events, subscription.visualTarget);
            }
            send(socket, { id: request.id, ok: true, result });
          } catch (error) {
            send(socket, { id: requestId, ok: false, error: errorText(error) });
          } finally {
            requestControllers.delete(controller);
          }
        })();
        inFlight.add(dispatched);
        void dispatched.finally(() => inFlight.delete(dispatched));
      },
    });
    socket.on('data', (chunk: string) => frames.push(chunk));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => {
      server.off('error', reject);
      resolve();
    });
  });

  /** Give up every resource acquired so far. Used by the startup rollback and
   * by ordinary shutdown, so both paths release the same things. */
  async function teardown(): Promise<void> {
    closing = true;
    // Synchronously stops accepting; the destroys below end what is connected.
    const finished = new Promise<void>((resolve) => server.close(() => resolve()));
    for (const socket of [...sockets]) socket.destroy();
    sockets.clear();
    // Drain what was already running. No cancellation semantics are needed:
    // the invariant is only that nothing new starts after the barrier and that
    // close() waits for what did.
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    await finished;
    if (process.platform !== 'win32') await unlink(pipe).catch(() => undefined);
  }

  const descriptor: PapersControlDescriptor = {
    protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
    pipe,
    token,
    pid: processId,
  };
  const temporary = `${descriptorPath}.${nonce}.tmp`;
  try {
    await mkdir(dirname(descriptorPath), { recursive: true });
    await writeFile(temporary, JSON.stringify(descriptor), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    // rename() replaces an existing destination, so a preceding unlink would
    // only create a window in which no descriptor exists. A crashed
    // predecessor's descriptor is superseded, not deleted first.
    if (publishDescriptor) await publishDescriptor(temporary, descriptorPath);
    else await rename(temporary, descriptorPath);
  } catch (error) {
    // Startup owns rollback of everything it acquired. Otherwise a publication
    // failure leaves a listening pipe with no descriptor and no registered
    // cleanup, because the caller never receives the server to close.
    await unlink(temporary).catch(() => undefined);
    await teardown();
    throw error;
  }

  let closed = false;
  return {
    descriptor,
    async close() {
      if (closed) return;
      closed = true;
      // Synchronously, before any await: once close() is invoked, no request
      // received afterwards may begin semantic dispatch. Setting this inside
      // teardown() left a window during the descriptor unlink in which a
      // connected client could still start a command.
      closing = true;
      await unlink(descriptorPath).catch(() => undefined);
      await teardown();
    },
  };
}
