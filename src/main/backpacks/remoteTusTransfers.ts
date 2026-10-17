import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AtomicJsonStore } from '../persistence/atomicStore';
import type { RemoteFileResources, RemoteFileEntry } from './remoteFileResources';

const route = '/v1/files/transfers';
const idPattern = /^[a-f0-9]{32}$/;
const hashPattern = /^[a-f0-9]{64}$/;

/** tus owns byte transport and recovery. Papers owns grants and publication.
 * Each grant has an isolated store; no upload IDs or client paths cross grants. */
export class RemoteTusTransfers {
  private readonly peers = new Map<string, { server: Server; store: FileStore; directory: string }>();
  private readonly publishing = new Map<string, Promise<RemoteFileEntry>>();
  constructor(private readonly directory: string) {}
  private async peer(deviceId: string, catalog: RemoteFileResources) {
    const key = createHash('sha256').update(deviceId).digest('hex');
    let peer = this.peers.get(key);
    if (peer) return peer;
    const directory = path.join(this.directory, key);
    await fs.mkdir(directory, { recursive: true });
    // Recheck after mkdir: concurrent first requests must share tus' same locker.
    peer = this.peers.get(key); if (peer) return peer;
    const store = new FileStore({ directory });
    const server = new Server({ path: route, datastore: store, relativeLocation: true,
      maxSize: 512 * 1024 ** 3, disableTerminationForFinishedUploads: true,
      onUploadCreate: async (_req, upload) => {
        const m = upload.metadata;
        if (!m || !/^[a-f0-9-]{36}$/.test(m.folderId ?? '') || !hashPattern.test(m.sha256 ?? '') || !m.name || /[\\/\0]/.test(m.name) || ['.', '..'].includes(m.name) || m.name.length > 255 || !Number.isSafeInteger(upload.size) || upload.size! < 0) throw { status_code: 400, body: 'Invalid transfer metadata' };
        if ((await catalog.stat(m.folderId!)).kind !== 'folder') throw { status_code: 400, body: 'Choose a destination folder' };
        return {};
      },
      onIncomingRequest: async (req, id) => {
        if (id && !idPattern.test(id)) throw { status_code: 404, body: 'Transfer unavailable' };
        // Upload bytes are private until explicit checked publication.
        if (req.method === 'GET') throw { status_code: 405, body: 'Use transfer status' };
      },
    });
    peer = { server, store, directory }; this.peers.set(key, peer); return peer;
  }
  async handle(request: IncomingMessage, response: ServerResponse, deviceId: string, catalog: RemoteFileResources, authorize: () => void): Promise<boolean> {
    const pathname = new URL(request.url!, 'http://papers.invalid').pathname;
    if (pathname !== route && !pathname.startsWith(route + '/')) return false;
    authorize();
    const peer = await this.peer(deviceId, catalog);
    const commit = new RegExp('^' + route + '/([a-f0-9]{32})/commit$').exec(pathname);
    if (commit) {
      if (request.method !== 'POST') { response.writeHead(405).end(); return true; }
      let length = 0; for await (const chunk of request) { length += chunk.length; if (length > 4096) throw Error('Transfer request too large'); }
      const id = commit[1]!;
      const key = deviceId + ':' + id;
      let pending = this.publishing.get(key);
      if (!pending) {
        pending = this.publish(peer, catalog, id, authorize); this.publishing.set(key, pending);
        void pending.finally(() => this.publishing.delete(key)).catch(() => {});
      }
      const entry = await pending; authorize();
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, entry })); return true;
    }
    await peer.server.handle(request, response); return true;
  }
  private async publish(peer: { store: FileStore; directory: string }, catalog: RemoteFileResources, id: string, authorize: () => void) {
    const receipt = new AtomicJsonStore(path.join(peer.directory, id + '.receipt.json'), { recoveryDir: path.join(peer.directory, 'recovery') });
    const saved = await receipt.load<{ entry: RemoteFileEntry }>();
    if (saved.value) return saved.value.entry;
    const upload = await peer.store.getUpload(id);
    if (upload.size === undefined || upload.offset !== upload.size) throw Error('Transfer is incomplete');
    const m = upload.metadata!;
    authorize();
    // receive verifies the final SHA-256 and preserves destination collision policy.
    const entry = await catalog.receive(m.folderId!, m.name!, upload.size, m.sha256!, peer.store.read(id));
    await receipt.save({ entry }); return entry;
  }
}
