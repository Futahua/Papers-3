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

/** Open a control connection. Responses and asynchronous event frames share
 * one stream, so a single demultiplexer owns reads for the whole socket. */
export async function connectPapersControl(descriptor) {
  const socket = createConnection(descriptor.pipe);
  await once(socket, 'connect');
  socket.setEncoding('utf8');
  const reader = createLineReader(socket);
  let nextId = 0;
  const pending = new Map();
  const eventHandlers = new Set();
  let ended = null;

  const failPending = (error) => {
    ended = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  // Do not let a response reader race with another response reader. Events
  // may arrive while any request is outstanding and are delivered without
  // consuming a request response.
  void (async () => {
    try {
      while (!ended) {
        const line = await reader.readLine();
        const frame = JSON.parse(line);
        if (frame?.type === 'event') {
          for (const handler of eventHandlers) handler(frame);
          continue;
        }
        const id = frame?.id;
        const entry = id === null
          ? pending.values().next().value
          : pending.get(id);
        if (!entry) continue;
        pending.delete(id === null ? entry.id : id);
        entry.resolve(frame);
      }
    } catch (error) {
      failPending(error);
    }
  })();

  return {
    socket,
    call(method, params = {}) {
      if (ended) return Promise.reject(ended);
      nextId += 1;
      const id = nextId;
      const response = new Promise((resolve, reject) => {
        pending.set(id, { id, resolve, reject });
      });
      socket.write(`${JSON.stringify({
        id,
        token: descriptor.token,
        protocolVersion: descriptor.protocolVersion,
        method,
        params,
      })}\n`);
      return response;
    },
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    close() {
      if (!ended) failPending(new Error('control connection closed'));
      socket.end();
    },
  };
}
