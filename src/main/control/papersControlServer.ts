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

const MAX_REQUEST_BYTES = 64 * 1024;

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
}: {
  descriptorPath: string;
  dependencies: PapersControlDependencies;
  processId?: number;
}): Promise<PapersControlServer> {
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(12).toString('hex');
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\papers-dev-${processId}-${nonce}`
    : `${descriptorPath}.${nonce}.sock`;
  const server: Server = createServer((socket) => {
    socket.setEncoding('utf8');
    let pending = '';
    socket.on('data', (chunk: string) => {
      pending += chunk;
      if (Buffer.byteLength(pending) > MAX_REQUEST_BYTES) {
        send(socket, { id: null, ok: false, error: 'request too large' });
        socket.destroy();
        return;
      }
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
        void (async () => {
          let requestId: string | number | null = null;
          try {
            const request = controlRequestSchema.parse(JSON.parse(line));
            requestId = request.id;
            if (!sameSecret(request.token, token)) throw new Error('unauthorized');
            const result = await dispatchPapersControl(dependencies, request);
            send(socket, { id: request.id, ok: true, result });
          } catch (error) {
            send(socket, { id: requestId, ok: false, error: errorText(error) });
          }
        })();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const descriptor: PapersControlDescriptor = {
    protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
    pipe,
    token,
    pid: processId,
  };
  await mkdir(dirname(descriptorPath), { recursive: true });
  const temporary = `${descriptorPath}.${nonce}.tmp`;
  await writeFile(temporary, JSON.stringify(descriptor), { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  // A crashed predecessor may have left an unusable descriptor. The fresh
  // random pipe/token pair is authoritative for this explicitly enabled run.
  await unlink(descriptorPath).catch(() => undefined);
  await rename(temporary, descriptorPath);

  let closed = false;
  return {
    descriptor,
    async close() {
      if (closed) return;
      closed = true;
      await unlink(descriptorPath).catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') await unlink(pipe).catch(() => undefined);
    },
  };
}
