import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

import {
  controlRequestSchema,
  dispatchPapersControl,
  PAPERS_CONTROL_PROTOCOL_VERSION,
  type PapersControlDependencies,
} from './papersControlProtocol';

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

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function send(socket: Socket, payload: unknown): void {
  if (socket.destroyed) return;
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
}: {
  descriptorPath: string;
  dependencies: PapersControlDependencies;
  processId?: number;
  /** Seam for proving the startup rollback: a publication failure after
   * `listen` must leave nothing listening and nothing on disk. */
  publishDescriptor?: (temporaryPath: string, finalPath: string) => Promise<void>;
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
  let closing = false;

  const server: Server = createServer((socket) => {
    if (closing) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.setEncoding('utf8');
    // A peer vanishing mid-write must not raise an unhandled error.
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));

    const frames = createFrameReader({
      maxFrameBytes: MAX_FRAME_BYTES,
      onOversize: () => {
        send(socket, { id: null, ok: false, error: 'request too large' });
        socket.destroy();
      },
      onFrame: (line) => {
        void (async () => {
          let requestId: string | number | null = null;
          try {
            const request = controlRequestSchema.parse(JSON.parse(line));
            requestId = request.id;
            if (!sameSecret(request.token, token)) throw new Error('unauthorized');
            // Nothing may mutate after the shutdown barrier.
            if (closing) throw new Error('control server is shutting down');
            const result = await dispatchPapersControl(dependencies, request);
            send(socket, { id: request.id, ok: true, result });
          } catch (error) {
            send(socket, { id: requestId, ok: false, error: errorText(error) });
          }
        })();
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
      await unlink(descriptorPath).catch(() => undefined);
      await teardown();
    },
  };
}
