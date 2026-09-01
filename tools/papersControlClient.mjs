import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

/**
 * The one control client. `papersctl` and the end-to-end test both use it, so
 * the tests exercise the real framing rather than another hand-written
 * approximation of it that can agree with a broken server.
 *
 * The protocol is newline-delimited JSON over a local pipe. A socket is a
 * stream: one `data` event is not one message. A response may arrive split
 * across deliveries, and two responses may arrive in one. Reading until a
 * newline is the only correct way to take a frame off it.
 */
export function createLineReader(socket) {
  let buffer = '';
  const waiting = [];
  let ended = null;

  const settle = () => {
    while (waiting.length > 0) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      waiting.shift().resolve(line);
    }
    if (ended) {
      while (waiting.length > 0) waiting.shift().reject(ended);
    }
  };

  socket.on('data', (chunk) => { buffer += chunk; settle(); });
  socket.on('end', () => { ended = new Error('control connection ended before a complete response'); settle(); });
  socket.on('error', (error) => { ended = error; settle(); });

  return {
    /** Resolve with the next complete newline-terminated frame. */
    readLine() {
      const newline = buffer.indexOf('\n');
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return Promise.resolve(line);
      }
      if (ended) return Promise.reject(ended);
      return new Promise((resolve, reject) => { waiting.push({ resolve, reject }); });
    },
  };
}

export async function readDescriptor(descriptorPath) {
  return JSON.parse(await readFile(resolve(descriptorPath), 'utf8'));
}

/** Open a control connection. The caller sends requests and reads replies in
 * order; the connection is closed with `close()`. */
export async function connectPapersControl(descriptor) {
  const socket = createConnection(descriptor.pipe);
  await once(socket, 'connect');
  socket.setEncoding('utf8');
  const reader = createLineReader(socket);
  let nextId = 0;
  /**
   * Requests are serialized per connection.
   *
   * The server dispatches each frame independently, so responses may complete
   * out of order. A client that simply awaits "the next line" would hand the
   * first caller the second caller's reply -- silently, and only when calls
   * overlap. Semantic control is stateful, so deterministic ordering is worth
   * more than pipelining here, and it leaves shutdown one clean tail per
   * socket to drain.
   */
  let tail = Promise.resolve();

  return {
    socket,
    call(method, params = {}) {
      const run = tail.then(async () => {
        nextId += 1;
        const id = nextId;
        socket.write(`${JSON.stringify({
          id,
          token: descriptor.token,
          protocolVersion: descriptor.protocolVersion,
          method,
          params,
        })}\n`);
        const response = JSON.parse(await reader.readLine());
        // Belt and braces: never hand back a reply that is not this request's.
        if (response.id !== id && response.id !== null) {
          throw new Error(`control response id ${String(response.id)} did not match request ${id}`);
        }
        return response;
      });
      // A failed call must not wedge the queue for the next one.
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    close() {
      socket.end();
    },
  };
}
