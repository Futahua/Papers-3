import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RemoteFileResources } from './remoteFileResources';
import type { RemoteFileEditOwner } from './remoteFileEditOwner';

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const buffers: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > 4096) throw new Error('Edit request is too large.');
    buffers.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(buffers).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid edit request.');
  return value as Record<string, unknown>;
}
function text(value: unknown) { if (typeof value !== 'string') throw new Error('Missing edit identity.'); return value; }

/** No client paths, script content, editor launch, or direct host IPC. */
export async function handleRemoteFileEditRoute(request: IncomingMessage, response: ServerResponse, context: {
  deviceId: string; canWrite: boolean; catalog: RemoteFileResources;
  owner?: RemoteFileEditOwner; authorize: () => void;
  editors?: { id: string; name: string }[];
  json: (response: ServerResponse, status: number, value: unknown) => void;
}): Promise<boolean> {
  if (!request.url?.startsWith('/v1/files/edits')) return false;
  let url: URL;
  try { url = new URL(request.url, 'http://gateway.invalid'); }
  catch { context.json(response, 400, { ok: false, code: 'EDIT_OPERATION_REFUSED' }); return true; }
  if (url.pathname !== '/v1/files/edits' && !url.pathname.startsWith('/v1/files/edits/')) return false;
  const send = (status: number, value: unknown) => { if (!response.destroyed) context.json(response, status, value); };
  if (!context.canWrite || !context.owner) { send(403, { ok: false, code: 'FILE_EDITS_NOT_GRANTED' }); return true; }
  const owner = context.owner;
  const cancellation = new AbortController();
  const aborted = () => cancellation.abort();
  const closed = () => { if (!response.writableEnded) cancellation.abort(); };
  request.once('aborted', aborted); response.once('close', closed);
  try {
    context.authorize(); owner.attach(context.deviceId, context.catalog);
    if (url.pathname === '/v1/files/edits/assignments') {
      if (request.method === 'GET') {
        send(200, { ok: true, assignments: await owner.assignments(context.deviceId, context.catalog), editors: context.editors ?? [] }); return true;
      }
      if (request.method === 'POST') {
        const value = await body(request); context.authorize();
        if (value.action === 'stop') {
          send(200, { ok: true, assignment: await owner.stopAssignment(context.deviceId, context.catalog, text(value.id)) }); return true;
        }
        const editor = text(value.editorDeviceId);
        if (!context.editors?.some(item => item.id === editor)) throw Error('Choose an authorized editing device');
        const assignment = await owner.assign(context.deviceId, context.catalog, text(value.resourceId), text(value.sourceVersion), editor);
        send(200, { ok: true, assignment: { id: assignment.id, editorDeviceId: assignment.editorDeviceId, active: assignment.active } }); return true;
      }
    }
    if (url.pathname === '/v1/files/edits' && request.method === 'GET') {
      send(200, { ok: true, sessions: owner.sessions.list(context.deviceId) }); return true;
    }
    if (url.pathname === '/v1/files/edits' && request.method === 'POST') {
      const value = await body(request); context.authorize();
      const session = await owner.begin(context.deviceId, context.catalog, text(value.resourceId), text(value.sourceVersion));
      context.authorize(); send(201, { ok: true, session }); return true;
    }
    const upload = /^\/v1\/files\/edits\/uploads\/([a-f0-9-]{36})(?:\/(seal))?$/.exec(url.pathname);
    if (upload) {
      const id = upload[1]!;
      if (!upload[2] && request.method === 'GET') {
        const status = await owner.uploads.status(context.deviceId, id); context.authorize(); send(200, { ok: true, upload: status }); return true;
      }
      if (!upload[2] && request.method === 'PUT') {
        const offset = url.searchParams.get('offset');
        if (!offset || !/^\d+$/.test(offset)) throw new Error('A resume offset is required.');
        const receivedBytes = await owner.uploads.append(context.deviceId, id, Number(offset), request, cancellation.signal);
        context.authorize(); send(200, { ok: true, receivedBytes }); return true;
      }
      if (upload[2] === 'seal' && request.method === 'POST') {
        await body(request); context.authorize(); await owner.uploads.seal(context.deviceId, id);
        context.authorize(); send(200, { ok: true }); return true;
      }
    }
    const session = /^\/v1\/files\/edits\/([a-f0-9-]{36})\/(uploads|save)$/.exec(url.pathname);
    if (session && request.method === 'POST') {
      const value = await body(request); context.authorize();
      if (session[2] === 'uploads') {
        if (typeof value.bytes !== 'number') throw new Error('Working-copy size is required.');
        const uploadId = await owner.beginUpload(context.deviceId, session[1]!, value.bytes, text(value.sha256));
        context.authorize(); send(201, { ok: true, uploadId });
      } else {
        const result = await owner.commit(context.deviceId, session[1]!, text(value.saveId), text(value.uploadId), text(value.sha256));
        context.authorize(); send(200, { ok: true, session: result });
      }
      return true;
    }
    send(405, { ok: false, code: 'EDIT_OPERATION_UNSUPPORTED' });
  } catch {
    // Retained receipts expose recovery status. Do not leak owner OS paths/errors.
    send(400, { ok: false, code: 'EDIT_OPERATION_REFUSED' });
  } finally { request.removeListener('aborted', aborted); response.removeListener('close', closed); }
  return true;
}
