import { logDevice } from './tailnetIdentity';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import * as path from 'node:path';
import { RemoteFileError, RemoteFileResources, type RemoteFileShare } from './remoteFileResources';
import type { RemoteFileEditOwner } from './remoteFileEditOwner';
import { handleRemoteFileEditRoute } from './remoteFileEditRoutes';

export interface RemoteFileGrant {
  deviceId: string;
  tokenHash: string;
  shares: RemoteFileShare[];
  canWrite?: boolean;
  backpacks?: RemoteBackpackShare[];
}
export interface RemoteBackpackShare { id:string; projectId:string; name:string; kind:'proxima' }
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
  join?: (peerAddress: string, name: string) => Promise<{ owner: { id: string; name: string }; deviceId: string; token: string; grant: RemoteFileGrant; replaced: string[] }>;
  mutate?: (deviceId: string, catalog: RemoteFileResources, request: unknown) => Promise<unknown>;
  changes?: (deviceId: string) => unknown;
  revokeChanges?: (deviceId: string) => void;
  edits?: RemoteFileEditOwner;
  /** Where files dropped on this computer from another device land by default. */
  inboxDirectory?: string;
  /** Runs this computer's own preview of a file; only self-contained results (text, image data) are returned. */
  preview?: (target: string) => Promise<Record<string, unknown>>;
  /** As you Go workspaces on this computer that same-account devices may open and edit. */
  workspaces?: {
    list: () => Promise<{ projectId: string; name: string }[]>;
    load: (projectId: string) => Promise<{ state: unknown; revision: string }>;
    save: (projectId: string, rawState: string, revision: string) => Promise<{ ok: boolean; revision: string; code?: string }>;
  };
  search?: (query: string, limit: number) => Promise<{ results: { path: string; name: string; kind: 'file' | 'folder'; size: number | null; modifiedAt: number | null }[] }>;
  backpackSnapshot?: (share:RemoteBackpackShare) => Promise<unknown>;
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
    if (request.url === '/v1/devices/join' && request.method === 'POST' && options.join) {
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 1024) throw new Error('Join request too large.');
        }
        const value: unknown = JSON.parse(body);
        const name = value && typeof value === 'object' ? (value as Record<string, unknown>).name : undefined;
        const peer = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
        if (typeof name !== 'string' || !peer) throw new Error('Invalid join request.');
        const joined = await options.join(peer, name);
        for (const id of joined.replaced) revoke(id);
        devices.set(joined.deviceId, { grant: joined.grant, catalog: await RemoteFileResources.create(joined.grant.shares, joined.grant.tokenHash), responses: new Set() });
        json(response, 200, { ok: true, protocol: 1, owner: joined.owner, deviceId: joined.deviceId, token: joined.token });
        logDevice('owner-admitted', { peer, name, deviceId: joined.deviceId, replaced: joined.replaced.length, shares: joined.grant.shares.map(share => share.name) });
      } catch (error) { logDevice('owner-refused', { peer: request.socket.remoteAddress, reason: error instanceof Error ? error.message : String(error) }); json(response, 403, { ok: false, code: 'JOIN_REFUSED' }); }
      return;
    }
    const authorization = request.headers.authorization ?? '';
    const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization)?.[1];
    const device = token && [...devices.values()].find(item => matches(token, item.grant.tokenHash));
    if (!device) { json(response, 401, { ok: false, code: 'DEVICE_UNAUTHORIZED' }); return; }
    device.responses.add(response);
    response.once('close', () => device.responses.delete(response));
    if (await handleRemoteFileEditRoute(request, response, {
      deviceId: device.grant.deviceId, canWrite: device.grant.canWrite === true,
      catalog: device.catalog, owner: options.edits, json,
      authorize: () => { if (devices.get(device.grant.deviceId) !== device || response.destroyed) throw new Error('Device access was revoked.'); },
    })) return;
    if(request.url==='/v1/files/changes'&&request.method==='GET') { json(response,200,{ok:true,jobs:options.changes?.(device.grant.deviceId)??[]});return; }
    if(request.url==='/v1/files/changes'&&request.method==='POST') {
      if(device.grant.canWrite!==true||!options.mutate){json(response,403,{ok:false,code:'FILE_CHANGES_NOT_GRANTED'});return;}
      try{
        let body='';for await(const chunk of request){body+=chunk.toString('utf8');if(Buffer.byteLength(body)>4096)throw new Error('File command is too large.');}
        json(response,202,{ok:true,job:await options.mutate(device.grant.deviceId,device.catalog,JSON.parse(body))});
      }catch(error){json(response,400,{ok:false,code:'FILE_COMMAND_REFUSED',message:error instanceof Error?error.message:'Invalid file command.'});}
      return;
    }
    const workspaceRoute = /^\/v1\/workspaces(?:\/([a-f0-9-]{36})\/state)?$/.exec(request.url ?? '');
    if (workspaceRoute) {
      if (device.grant.canWrite !== true || !options.workspaces) { json(response, 403, { ok: false, code: 'WORKSPACES_NOT_GRANTED' }); return; }
      try {
        // Stable per device and workspace, so a client can keep using an id across restarts.
        const idFor = (projectId: string) => { const h = createHash('sha256').update(device.grant.deviceId + '|' + projectId).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
        const all = await options.workspaces.list();
        if (!workspaceRoute[1]) { json(response, 200, { ok: true, owner: options.owner, entries: all.map(item => ({ id: idFor(item.projectId), name: item.name, kind: 'as-you-go' })) }); return; }
        const target = all.find(item => idFor(item.projectId) === workspaceRoute[1]);
        if (!target) { json(response, 404, { ok: false, code: 'WORKSPACE_UNKNOWN' }); return; }
        if (request.method === 'GET') { json(response, 200, { ok: true, ...await options.workspaces.load(target.projectId) }); return; }
        if (request.method !== 'POST') { json(response, 405, { ok: false, code: 'OPERATION_UNSUPPORTED' }); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) throw new Error('Workspace document is too large.'); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof body.state !== 'string' || typeof body.revision !== 'string') throw new Error('A document and the revision it was built on are required.');
        // The owner decides: a save built on an older revision is refused, never merged here.
        const result = await options.workspaces.save(target.projectId, body.state, body.revision);
        logDevice('owner-workspace-save', { deviceId: device.grant.deviceId, project: target.projectId, ok: result.ok, code: result.code });
        json(response, 200, { ok: true, save: result });
      } catch (error) { if (!response.headersSent) json(response, 400, { ok: false, code: 'WORKSPACE_REFUSED', message: error instanceof Error ? error.message : 'Workspace request refused.' }); }
      return;
    }
    const upload = /^\/v1\/files\/(inbox|[a-f0-9-]{36}\/upload)(?:\?.*)?$/.exec(request.url ?? '');
    if (upload) {
      if (device.grant.canWrite !== true) { json(response, 403, { ok: false, code: 'FILE_CHANGES_NOT_GRANTED' }); return; }
      try {
        if (upload[1] === 'inbox' && request.method === 'GET') {
          json(response, 200, { ok: true, ...await device.catalog.inbox(options.inboxDirectory ?? path.join(os.homedir(), 'Downloads', 'Papers Inbox')) });
          return;
        }
        if (upload[1] !== 'inbox' && request.method === 'PUT') {
          const query = new URL(request.url ?? '/', 'http://gateway.invalid').searchParams;
          const entry = await device.catalog.receive(upload[1]!.slice(0, 36), query.get('name') ?? '', Number(query.get('size')), query.get('sha256') ?? '', request);
          logDevice('owner-received', { deviceId: device.grant.deviceId, name: entry.name, bytes: entry.size });
          json(response, 201, { ok: true, entry });
          return;
        }
        json(response, 405, { ok: false, code: 'OPERATION_UNSUPPORTED' });
      } catch (error) {
        const code = error instanceof RemoteFileError ? error.code : 'UPLOAD_FAILED';
        if (!response.headersSent) json(response, code === 'RESOURCE_UNKNOWN' ? 404 : 400, { ok: false, code, message: error instanceof Error ? error.message : 'Upload failed.' });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { ok: false, code: 'OPERATION_UNSUPPORTED' }); return; }
    try {
      const url = new URL(request.url ?? '/', 'http://gateway.invalid');
      if(url.pathname==='/v1/backpacks'){
        json(response,200,{ok:true,owner:options.owner,entries:(device.grant.backpacks??[]).map(({id,name,kind})=>({id,name,kind}))});return;
      }
      const backpackMatch=/^\/v1\/backpacks\/([a-f0-9-]{36})\/snapshot$/.exec(url.pathname);
      if(backpackMatch){
        const share=device.grant.backpacks?.find(item=>item.id===backpackMatch[1]);
        if(!share){json(response,403,{ok:false,code:'BACKPACK_NOT_GRANTED'});return;}
        if(!options.backpackSnapshot){json(response,503,{ok:false,code:'BACKPACK_OWNER_UNAVAILABLE'});return;}
        try{const snapshot=await options.backpackSnapshot(share);if(devices.get(device.grant.deviceId)!==device||response.destroyed)return;json(response,200,{ok:true,owner:options.owner,resourceId:share.id,kind:share.kind,snapshot});}
        catch{if(!response.destroyed)json(response,503,{ok:false,code:'BACKPACK_OWNER_UNAVAILABLE'});}return;
      }
      if (url.pathname === '/v1/files/search') {
        if (!options.search) { json(response, 503, { ok: false, code: 'SEARCH_UNAVAILABLE' }); return; }
        const query = (url.searchParams.get('q') ?? '').slice(0, 1024), limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));
        // Only results inside this device's grant are returned, as share-relative parts; no OS path leaves the owner.
        const results = query.trim() ? (await options.search(query, limit)).results.flatMap(result => {
          const parts = device.catalog.shareParts(result.path);
          return parts ? [{ parts, name: result.name, kind: result.kind, size: result.size, modifiedAt: result.modifiedAt }] : [];
        }) : [];
        json(response, 200, { ok: true, results });
        return;
      }
      if (url.pathname === '/v1/files/shares') {
        json(response, 200, { ok: true, protocol: 1, owner: options.owner, capabilities:{changes:Boolean(device.grant.canWrite===true&&options.mutate),edits:Boolean(device.grant.canWrite===true&&options.edits)}, entries: await device.catalog.shares() });
        return;
      }
      const previewMatch = /^\/v1\/files\/([a-f0-9-]{36})\/preview$/.exec(url.pathname);
      if (previewMatch) {
        if (!options.preview) { json(response, 503, { ok: false, code: 'PREVIEW_UNAVAILABLE' }); return; }
        const result = await options.preview(await device.catalog.ownerPath(previewMatch[1]!));
        const preview = result['preview'] as Record<string, unknown> | undefined;
        const portable = preview && (preview['kind'] === 'text' ? typeof preview['text'] === 'string' : (preview['kind'] === 'image' && typeof preview['dataUrl'] === 'string'));
        json(response, 200, { ok: true, preview: portable ? { kind: preview!['kind'], text: preview!['text'], nextOffset: preview!['nextOffset'], eof: preview!['eof'], mime: preview!['mime'], dataUrl: preview!['dataUrl'], width: preview!['width'], height: preview!['height'] } : { kind: 'none' } });
        return;
      }
      const match = /^\/v1\/files\/([a-f0-9-]{36})\/(list|stat|content|digest)$/.exec(url.pathname);
      if (!match) { json(response, 404, { ok: false, code: 'OPERATION_UNKNOWN' }); return; }
      const id = match[1]!;
      if (match[2] === 'list') {
        json(response, 200, { ok: true, capabilities:{changes:Boolean(device.grant.canWrite===true&&options.mutate),edits:Boolean(device.grant.canWrite===true&&options.edits)},folder:await device.catalog.stat(id), ...await device.catalog.list(id, Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('limit') ?? 200)) });
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
      options.revokeChanges?.(deviceId);
      options.edits?.revoke(deviceId);
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
