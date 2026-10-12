import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { RemoteFileError, RemoteFileResources, type RemoteFileShare } from './remoteFileResources';

export interface RemoteFileGrant {
  deviceId: string;
  tokenHash: string;
  shares: RemoteFileShare[];
}
export function remoteTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function matches(token: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(remoteTokenHash(token), 'hex'), Buffer.from(expected, 'hex'));
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

/** A narrow file boundary. No renderer IPC, launch, native input, or arbitrary path endpoint. */
export async function createRemoteFileGateway(options: {
  owner: { id: string; name: string };
  grants: RemoteFileGrant[];
  pair?: (code: string, name: string) => Promise<{ owner: { id: string; name: string }; deviceId: string; token: string; grant: RemoteFileGrant }>;
}): Promise<{ server: Server; revoke: (deviceId: string) => void; close: () => Promise<void> }> {
  const devices = new Map<string, { grant: RemoteFileGrant; catalog: RemoteFileResources; responses: Set<ServerResponse> }>();
  const tokenHashes = new Set<string>();
  for (const grant of options.grants) {
    if (!grant.deviceId || devices.has(grant.deviceId) || !/^[a-f0-9]{64}$/.test(grant.tokenHash) || tokenHashes.has(grant.tokenHash)) throw new Error('Invalid or duplicate device grant.');
    tokenHashes.add(grant.tokenHash);
    devices.set(grant.deviceId, { grant, catalog: await RemoteFileResources.create(grant.shares, grant.tokenHash), responses: new Set() });
  }
  const server = createServer((request, response) => { void handle(request, response); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 40;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url === '/v1/devices/pair' && request.method === 'POST' && options.pair) {
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 1024) throw new Error('Pairing request too large.');
        }
        const value: unknown = JSON.parse(body);
        if (!value || typeof value !== 'object') throw new Error('Invalid pairing request.');
        const { code, name } = value as Record<string, unknown>;
        if (typeof code !== 'string' || typeof name !== 'string') throw new Error('Invalid pairing request.');
        const paired = await options.pair(code, name);
        devices.set(paired.deviceId, { grant: paired.grant, catalog: await RemoteFileResources.create(paired.grant.shares, paired.grant.tokenHash), responses: new Set() });
        json(response, 200, { ok: true, protocol: 1, owner: paired.owner, deviceId: paired.deviceId, token: paired.token });
      } catch { json(response, 403, { ok: false, code: 'PAIRING_REFUSED' }); }
      return;
    }
    const authorization = request.headers.authorization ?? '';
    const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization)?.[1];
    const device = token && [...devices.values()].find(item => matches(token, item.grant.tokenHash));
    if (!device) { json(response, 401, { ok: false, code: 'DEVICE_UNAUTHORIZED' }); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { ok: false, code: 'OPERATION_UNSUPPORTED' }); return; }
    device.responses.add(response);
    response.once('close', () => device.responses.delete(response));
    try {
      const url = new URL(request.url ?? '/', 'http://gateway.invalid');
      if (url.pathname === '/v1/files/shares') {
        json(response, 200, { ok: true, protocol: 1, owner: options.owner, entries: await device.catalog.shares() });
        return;
      }
      const match = /^\/v1\/files\/([a-f0-9-]{36})\/(list|stat|content|digest)$/.exec(url.pathname);
      if (!match) { json(response, 404, { ok: false, code: 'OPERATION_UNKNOWN' }); return; }
      const id = match[1]!;
      if (match[2] === 'list') {
        json(response, 200, { ok: true, ...await device.catalog.list(id, Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('limit') ?? 200)) });
        return;
      }
      if (match[2] === 'stat') { json(response, 200, { ok: true, entry: await device.catalog.stat(id) }); return; }
      const expected = request.headers['if-match'];
      if (typeof expected !== 'string' || !/^"[a-f0-9]{64}"$/.test(expected)) {
        json(response, 428, { ok: false, code: 'VERSION_REQUIRED' }); return;
      }
      if (match[2] === 'digest') {
        json(response, 200, { ok: true, ...await device.catalog.digest(id, expected.slice(1, -1)) });
        return;
      }
      const lease = await device.catalog.open(id, expected.slice(1, -1));
      try {
        let start = 0;
        let end = lease.entry.size - 1;
        const range = request.headers.range;
        if (range) {
          const parsed = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (!parsed) { response.writeHead(416, { 'Content-Range': `bytes */${lease.entry.size}` }); response.end(); return; }
          start = Number(parsed[1]);
          end = parsed[2] ? Number(parsed[2]) : end;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= lease.entry.size || end >= lease.entry.size) {
            response.writeHead(416, { 'Content-Range': `bytes */${lease.entry.size}` }); response.end(); return;
          }
        }
        await lease.verify();
        response.writeHead(range ? 206 : 200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': range ? end - start + 1 : lease.entry.size,
          'Accept-Ranges': 'bytes',
          ETag: `"${lease.entry.version}"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${lease.entry.size}` } : {}),
        });
        if (request.method === 'HEAD' || !lease.entry.size) { response.end(); return; }
        // Check the owner version again at stream completion. Clients must also
        // verify their completed content; Content-Length alone is not integrity.
        await pipeline(lease.handle.createReadStream({ start, end, autoClose: false }), response, { end: false });
        await lease.verify();
        response.end();
      } finally { await lease.handle.close(); }
    } catch (error) {
      if (response.headersSent) { response.destroy(error instanceof Error ? error : undefined); return; }
      const code = error instanceof RemoteFileError ? error.code : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'RESOURCE_GONE' : 'OPERATION_FAILED';
      const status = code === 'VERSION_CHANGED' ? 412 : code === 'RESOURCE_OUTSIDE_SHARE' ? 403 : code === 'RESOURCE_UNKNOWN' || code === 'RESOURCE_GONE' ? 404 : code === 'PAGE_INVALID' ? 400 : 500;
      json(response, status, { ok: false, code });
    }
  }
  const revoke = (deviceId: string): void => {
      const device = devices.get(deviceId);
      devices.delete(deviceId);
      for (const response of device?.responses ?? []) response.destroy();
  };
  return {
    server,
    revoke,
    async close() {
      for (const id of devices.keys()) revoke(id);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
