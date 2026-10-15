import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {InboxNode} from './inboxTransfers';
import type { RemoteFileEntry } from './remoteFileResources';

/**
 * Presents a paired device's shared drives as ordinary Windows-style paths
 * (`\\papers~<ownerId>\D:\Users\...`) so AYG's own file view, previews and file
 * operations work on them unchanged. Every request still goes through the
 * remote client's opaque, version-checked resources; no OS path crosses devices.
 */
export const REMOTE_PATH_PREFIX = '\\\\papers~';
const PATTERN = /^\\\\papers~([a-f0-9-]{36})(?:\\(.*))?$/i;
export function parseRemotePath(value: unknown): { ownerId: string; parts: string[] } | null {
  if (typeof value !== 'string') return null;
  const match = PATTERN.exec(value.replace(/\//g, '\\').replace(/\\+$/, ''));
  return match ? { ownerId: match[1]!.toLowerCase(), parts: (match[2] ?? '').split('\\').filter(Boolean) } : null;
}
export const isRemotePath = (value: unknown): boolean => parseRemotePath(value) !== null;
export const remotePath = (ownerId: string, parts: string[]): string => [`${REMOTE_PATH_PREFIX}${ownerId}`, ...parts].join('\\');

export interface RemotePathClient {
  snapshot(): { devices: { id: string; name: string; address: string }[] };
  browse(ownerId: string, resourceId?: string, offset?: number): Promise<{ entries: RemoteFileEntry[]; nextOffset: number | null; online: boolean; error?: string }>;
  change(ownerId: string, command: unknown): Promise<unknown>;
  changes(ownerId: string): Promise<{ commandId: string; phase: string; error?: string }[]>;
  materialize(ownerId: string, entry: unknown): Promise<string>;
  ownerPreview?(ownerId: string, entry: unknown): Promise<Record<string, unknown> | null>;
  isCached?(ownerId: string, entry: unknown): Promise<boolean>;
  upload(ownerId: string, folderId: string, localFile: string, name: string): Promise<RemoteFileEntry>;
  inbox(ownerId: string): Promise<{ entry: RemoteFileEntry; parts: string[];chosen?:boolean }>;
  setInbox?:(ownerId:string,parts:string[]|null)=>Promise<{entry:RemoteFileEntry;parts:string[];chosen?:boolean}>;
  search(ownerId: string, query: string, limit: number): Promise<{ parts: string[]; name: string; kind: 'file' | 'folder'; size: number | null; modifiedAt: number | null }[]>;
}
type Resolved = { ownerId: string; parts: string[]; entry: RemoteFileEntry | null };
type Call = (operation: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;

const LISTING_TTL_MS = 2_000;
const UNSUPPORTED = new Set(['open', 'reveal', 'native-drag', 'office-editor-open', 'office-editor-save', 'preview-markdown-obsidian']);

export function createRemotePaths(client: RemotePathClient, options: { iconDirectory: string; fileIcon: (target: string) => Promise<unknown>; settingsFile?: string }) {
  // Chosen inbox per device, as share-relative parts ("C:", "Users", ...). Missing means the device's default.
  let inboxes: Record<string, string[]> | null = null;
  const readInboxes = async (): Promise<Record<string, string[]>> => inboxes ??= options.settingsFile
    ? await fs.readFile(options.settingsFile, 'utf8').then(text => JSON.parse(text).inboxes ?? {}, () => ({}))
    : {};
  const listings = new Map<string, { at: number; entries: RemoteFileEntry[]; online: boolean }>();
  const deviceName = (ownerId: string) => client.snapshot().devices.find(device => device.id === ownerId)?.name ?? 'Device';

  async function listAll(ownerId: string, resourceId?: string) {
    const key = `${ownerId}|${resourceId ?? ''}`, cached = listings.get(key);
    if (cached && Date.now() - cached.at < LISTING_TTL_MS) return cached;
    const entries: RemoteFileEntry[] = [];
    let offset: number | null = 0, online = true;
    while (offset !== null) {
      const page = await client.browse(ownerId, resourceId, offset);
      entries.push(...page.entries); online &&= page.online; offset = page.nextOffset;
    }
    const value = { at: Date.now(), entries, online };
    listings.set(key, value);
    return value;
  }
  async function resolve(target: unknown): Promise<Resolved> {
    const parsed = parseRemotePath(target);
    if (!parsed) throw new Error('Not a remote path.');
    if (!client.snapshot().devices.some(device => device.id === parsed.ownerId)) throw new Error('That device is not connected.');
    let entry: RemoteFileEntry | null = null;
    for (const part of parsed.parts) {
      const { entries } = await listAll(parsed.ownerId, entry?.id);
      const next = entries.find(item => item.name === part) ?? entries.find(item => item.name.toLowerCase() === part.toLowerCase());
      if (!next) throw Object.assign(new Error('That item is no longer on the device.'), { code: 'ENOENT' });
      entry = next;
    }
    return { ...parsed, entry };
  }
  function describe(ownerId: string, parts: string[], entry: RemoteFileEntry | null) {
    const kind = entry?.kind ?? 'folder';
    return {
      path: remotePath(ownerId, parts),
      name: entry ? entry.name : deviceName(ownerId),
      parent: parts.length ? remotePath(ownerId, parts.slice(0, -1)) : remotePath(ownerId, []),
      kind,
      extension: kind === 'file' ? path.extname(entry!.name).toLowerCase() : '',
      size: kind === 'file' ? entry!.size : null,
      createdAt: null,
      modifiedAt: entry ? Math.round(entry.modifiedAt) : null,
      identity: entry ? `${ownerId}:${entry.id}` : ownerId,
      remote: { ownerId, device: deviceName(ownerId) },
    };
  }
  async function command(ownerId: string, body: Record<string, unknown>) {
    const commandId = randomUUID();
    await client.change(ownerId, { commandId, ...body });
    for (let attempt = 0; attempt < 600; attempt++) {
      const job = (await client.changes(ownerId)).find(item => item.commandId === commandId);
      if (job && ['completed', 'failed', 'uncertain'].includes(job.phase)) {
        forget(ownerId);
        if (job.phase !== 'completed') throw new Error(job.error || `The device reported ${job.phase}.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('The device did not confirm the change.');
  }
  const ownerOf = (value: unknown) => parseRemotePath(value)?.ownerId ?? 'local';
  function sameOwner(paths: unknown[]): string | null {
    const owners = new Set(paths.map(ownerOf));
    return owners.size === 1 && !owners.has('local') ? [...owners][0]! : null;
  }
  async function freeLocalName(folder: string, name: string): Promise<string> {
    const extension = path.extname(name), stem = name.slice(0, name.length - extension.length);
    for (let attempt = 1; ; attempt++) {
      const target = path.join(folder, attempt === 1 ? name : `${stem} (${attempt})${extension}`);
      if (!(await fs.lstat(target).then(() => true, () => false))) return target;
    }
  }
  async function freeRemoteName(ownerId: string, folderId: string, name: string): Promise<string> {
    const taken = new Set((await listAll(ownerId, folderId)).entries.map(item => item.name.toLowerCase()));
    const extension = path.extname(name), stem = name.slice(0, name.length - extension.length);
    for (let attempt = 1; ; attempt++) { const next = attempt === 1 ? name : `${stem} (${attempt})${extension}`; if (!taken.has(next.toLowerCase())) return next; }
  }
  function forget(ownerId: string) { for (const key of [...listings.keys()]) if (key.startsWith(ownerId + '|')) listings.delete(key); }
  /** Copies one file or folder into a folder on another side (this PC or a device). Never overwrites. */
  async function copyAcross(source: string, destination: string): Promise<string> {
    const from = parseRemotePath(source), to = parseRemotePath(destination);
    const fromEntry = from ? (await resolve(source)).entry : null;
    if (from && !fromEntry) throw new Error('Drives cannot be copied.');
    const name = from ? fromEntry!.name : path.basename(source);
    const isFolder = from ? fromEntry!.kind === 'folder' : (await fs.stat(source)).isDirectory();
    const children = async (): Promise<string[]> => from
      ? (await listAll(from.ownerId, fromEntry!.id)).entries.map(item => remotePath(from.ownerId, [...from.parts, item.name]))
      : (await fs.readdir(source)).map(child => path.join(source, child));
    if (!to) {
      if (isFolder) {
        const target = await freeLocalName(destination, name);
        await fs.mkdir(target);
        for (const child of await children()) await copyAcross(child, target);
        return target;
      }
      const target = await freeLocalName(destination, name);
      await fs.copyFile(from ? await client.materialize(from.ownerId, fromEntry) : source, target, fs.constants.COPYFILE_EXCL);
      return target;
    }
    const folder = (await resolve(destination)).entry;
    if (!folder || folder.kind !== 'folder') throw new Error('Choose a destination folder.');
    const targetName = await freeRemoteName(to.ownerId, folder.id, name);
    if (isFolder) {
      await command(to.ownerId, { operation: 'create-folder', resourceId: folder.id, expectedVersion: folder.version, newName: targetName });
      const target = `${destination}\\${targetName}`;
      for (const child of await children()) await copyAcross(child, target);
      return target;
    }
    const local = from ? await client.materialize(from.ownerId, fromEntry) : source;
    const sent = await client.upload(to.ownerId, folder.id, local, targetName);
    forget(to.ownerId);
    return `${destination}\\${sent.name}`;
  }
  // Replace the materialized local path with the remote path wherever a result echoes it.
  function relabel(value: unknown, local: string, remote: string): unknown {
    if (typeof value === 'string') return value === local ? remote : value;
    if (Array.isArray(value)) return value.map(item => relabel(item, local, remote));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabel(item, local, remote)]));
    return value;
  }

  /** Returns the folder, creating any missing part of the path on the device. */
  async function ensureFolder(ownerId: string, parts: string[]): Promise<string> {
    for (let depth = 1; depth <= parts.length; depth++) {
      const here = remotePath(ownerId, parts.slice(0, depth));
      if (await resolve(here).then(found => found.entry?.kind === 'folder', () => false)) continue;
      if (depth === 1) throw new Error(`${parts[0]} is not a drive on that device.`);
      const parent = (await resolve(remotePath(ownerId, parts.slice(0, depth - 1)))).entry!;
      await command(ownerId, { operation: 'create-folder', resourceId: parent.id, expectedVersion: parent.version, newName: parts[depth - 1] });
    }
    return remotePath(ownerId, parts);
  }
  async function inbox(ownerId: string): Promise<{ path: string; parts: string[]; chosen: boolean }> {
    const chosen = (await readInboxes())[ownerId];
    if (chosen) return { path: await ensureFolder(ownerId, chosen), parts: chosen, chosen: true };
    const fallback = await client.inbox(ownerId);
    forget(ownerId);
    return { path: remotePath(ownerId, fallback.parts), parts: fallback.parts, chosen: fallback.chosen===true };
  }

  return {
    copyToFolder:copyAcross,
    async planImport(paths:string[]):Promise<InboxNode[]>{
      let count=0;
      const fresh=async(ownerId:string,id?:string)=>{const all:RemoteFileEntry[]=[];let offset:number|null=0;while(offset!==null){// A listing that fails is retried, never answered from cache; the device's own error is kept.
        let page:{entries:RemoteFileEntry[];nextOffset:number|null;online:boolean;error?:string}=await client.browse(ownerId,id,offset).catch(error=>({entries:[],nextOffset:null,online:false,error:error instanceof Error?error.message:String(error)}));
        for(let attempt=1;!page.online&&attempt<4;attempt++){await new Promise(resolve=>setTimeout(resolve,attempt*700));page=await client.browse(ownerId,id,offset).catch(error=>({entries:[],nextOffset:null,online:false,error:error instanceof Error?error.message:String(error)}));}
        if(!page.online)throw Error('The source device did not answer: '+((page as {error?:string}).error||'unavailable')+'. Resume to try again.');all.push(...page.entries);offset=page.nextOffset;}return all;};
      const walk=async(source:string,ownerId:string,entry:RemoteFileEntry,depth:number):Promise<InboxNode>=>{if(++count>100000||depth>128)throw Error('The selected folder is too large or deeply nested.');const children:InboxNode[]=[];if(entry.kind==='folder')for(const child of await fresh(ownerId,entry.id))children.push(await walk(source+'\\'+child.name,ownerId,child,depth+1));return {source,ownerId,entry,children};};
      const roots:InboxNode[]=[];for(const source of paths){const parsed=parseRemotePath(source);if(!parsed||!parsed.parts.length)throw Error('Select a file or folder on a device.');let current:RemoteFileEntry|undefined;for(const part of parsed.parts){current=(await fresh(parsed.ownerId,current?.id)).find(item=>item.name.toLowerCase()===part.toLowerCase());if(!current)throw Error('The selected source is no longer available.');}roots.push(await walk(source,parsed.ownerId,current!,0));}return roots;
    },
    inbox,
    /** Sets a device's inbox from a path as typed on that device (C:\Users\me\Inbox); null restores the default. */
    async setInbox(ownerId: string, text: string | null): Promise<{ path: string; parts: string[]; chosen: boolean }> {
      if(client.setInbox){const parts=text===null?null:text.trim().replace(/\//g,'\\').split('\\').filter(Boolean);if(parts&&(!parts.length||parts.some(part=>part==='.'||part==='..')))throw Error('Choose a valid inbox folder.');const selected=await client.setInbox(ownerId,parts);return {path:remotePath(ownerId,selected.parts),parts:selected.parts,chosen:selected.chosen===true};}
      const all = await readInboxes();
      if (text === null || !text.trim()) delete all[ownerId];
      else {
        const parts = text.trim().replace(/\//g, '\\').split('\\').filter(Boolean);
        const valid = /^[A-Za-z]:$/.test(parts[0] ?? '') && parts.slice(1).every(part => part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]/.test(part));
        if (!valid) throw new Error('Type a folder path on that device, like C:\\Users\\me\\Inbox.');
        parts[0] = parts[0]!.toUpperCase();
        await ensureFolder(ownerId, parts);
        all[ownerId] = parts;
      }
      if (options.settingsFile) {
        await fs.mkdir(path.dirname(options.settingsFile), { recursive: true });
        await fs.writeFile(options.settingsFile, JSON.stringify({ inboxes: all }, null, 1));
      }
      return inbox(ownerId);
    },
    /** Copies local files into a device's inbox; used when something is dropped into that device's As you Go. */
    async sendToInbox(ownerId: string, paths: string[]): Promise<string[]> {
      const target = (await inbox(ownerId)).path, created: string[] = [];
      for (const source of paths) created.push(await copyAcross(source, target));
      return created;
    },
    devices: () => client.snapshot().devices.map(device => ({ id: device.id, name: device.name, path: remotePath(device.id, []) })),
    /** Returns null when the request has nothing remote in it, so local handling continues. */
    async handle(operation: string, params: Record<string, unknown>, call: Call): Promise<Record<string, unknown> | null> {
      const paths = Array.isArray(params.paths) ? params.paths : [];
      if (![params.path, params.destination, ...paths].some(isRemotePath)) return null;
      if (UNSUPPORTED.has(operation)) return { ok: false, code: 'REMOTE_UNSUPPORTED', message: 'Not available for files on another device yet.' };
      switch (operation) {
        case 'search': {
          // Searching while inside a device searches that device, with its own Everything.
          const { ownerId } = parseRemotePath(params.path)!;
          const found = await client.search(ownerId, String(params.query ?? ''), Math.min(1000, Number(params.limit) || 100));
          const results = found.map(item => ({ path: remotePath(ownerId, item.parts), name: item.name, kind: item.kind, size: item.size, modifiedAt: item.modifiedAt, attributes: 0 }));
          return { ok: true, provider: 'everything', version: null, total: results.length, results };
        }
        case 'stat': {
          const { ownerId, parts, entry } = await resolve(params.path);
          const cached = entry?.kind === 'file' && client.isCached ? await client.isCached(ownerId, entry).catch(() => false) : false;
          return { ok: true, entry: { ...describe(ownerId, parts, entry), cached } };
        }
        case 'list': {
          const { ownerId, parts, entry } = await resolve(params.path);
          if (entry && entry.kind !== 'folder') throw new Error('That path is not a folder.');
          const listing = await listAll(ownerId, entry?.id);
          const items = listing.entries.map(item => describe(ownerId, [...parts, item.name], item))
            .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
          return { ok: true, entry: describe(ownerId, parts, entry), items, truncated: false, online: listing.online };
        }
        case 'icon': {
          // The icon depends only on the kind and extension, so ask the shell about a local stand-in.
          const parsed = parseRemotePath(params.path)!;
          const name = parsed.parts.at(-1) ?? '';
          const ext = /^\.[A-Za-z0-9]{1,15}$/.test(path.extname(name)) ? path.extname(name).toLowerCase() : '';
          const folder = !ext || parsed.parts.length < 2;
          const standIn = path.join(options.iconDirectory, folder ? 'folder' : `file${ext}`);
          if (folder) await fs.mkdir(standIn, { recursive: true });
          else { await fs.mkdir(options.iconDirectory, { recursive: true }); await fs.writeFile(standIn, '', { flag: 'a' }); }
          return { ok: true, icon: await options.fileIcon(standIn) };
        }
        case 'create-folder': {
          const { ownerId, entry } = await resolve(params.path);
          if (!entry) throw new Error('Choose a drive first.');
          await command(ownerId, { operation: 'create-folder', resourceId: entry.id, expectedVersion: entry.version, newName: String(params.newName ?? '') });
          return call('stat', { path: `${params.path}\\${String(params.newName)}` });
        }
        case 'rename': {
          const { ownerId, parts, entry } = await resolve(params.path);
          if (!entry || parts.length < 2) throw new Error('Drives cannot be renamed.');
          await command(ownerId, { operation: 'rename', resourceId: entry.id, expectedVersion: entry.version, newName: String(params.newName ?? '') });
          return { ok: true, operation, path: remotePath(ownerId, [...parts.slice(0, -1), String(params.newName)]) };
        }
        case 'delete': {
          const ownerId = sameOwner(paths);
          if (!ownerId) throw new Error('Delete items from one device at a time.');
          for (const target of paths) {
            const { parts, entry } = await resolve(target);
            if (!entry || parts.length < 2) throw new Error('Drives cannot be deleted.');
            await command(ownerId, { operation: 'delete', resourceId: entry.id, expectedVersion: entry.version });
          }
          return { ok: true, operation };
        }
        case 'copy':
        case 'move': {
          const ownerId = sameOwner([...paths, params.destination]);
          // Between this PC and a device, or between two devices, a drag always copies.
          if (!ownerId) {
            const created: string[] = [];
            for (const source of paths) created.push(await copyAcross(String(source), String(params.destination)));
            return { ok: true, operation: 'copy', paths: created };
          }
          const destination = await resolve(params.destination);
          if (!destination.entry || destination.entry.kind !== 'folder') throw new Error('Choose a destination folder.');
          for (const target of paths) {
            const { entry } = await resolve(target);
            if (!entry) throw new Error('Drives cannot be copied or moved.');
            const fresh = (await resolve(params.destination)).entry!;
            await command(ownerId, { operation, resourceId: entry.id, expectedVersion: entry.version, destinationId: fresh.id, destinationVersion: fresh.version });
          }
          return { ok: true, operation };
        }
        case 'preview': {
          if (isRemotePath(params.path) && params.skipWindowsPreview !== true) {
            const { ownerId, parts, entry } = await resolve(params.path);
            if (entry && entry.kind === 'file') {
              // The owner renders images and text itself: no download. Only formats that need the file
              // (PDF, media, Office) download a copy, and above 100 MB only once the creator agrees.
              const rendered = client.ownerPreview ? await client.ownerPreview(ownerId, entry).catch(() => null) : null;
              if (rendered) return { ok: true, entry: describe(ownerId, parts, entry), preview: { ...rendered, extractedBy: 'owner-preview' } };
              if (entry.size > 100 * 1024 * 1024 && params.allowLargeDownload !== true && !(client.isCached && await client.isCached(ownerId, entry).catch(() => false)))
                return { ok: false, code: 'LARGE_DOWNLOAD_CONFIRM', size: entry.size, entry: describe(ownerId, parts, entry), message: 'This file is larger than 100 MB.' };
            }
          }
        }
        // falls through: a preview that needs the file itself downloads a verified copy
        default: {
          // Previews and every other read of one file run on a verified local copy of it.
          if (!isRemotePath(params.path)) return { ok: false, code: 'REMOTE_UNSUPPORTED', message: 'Not available for files on another device yet.' };
          const { ownerId, entry } = await resolve(params.path);
          if (!entry || entry.kind !== 'file') return { ok: false, code: 'REMOTE_UNSUPPORTED', message: 'Not available for folders on another device yet.' };
          const local = await client.materialize(ownerId, entry);
          return relabel(await call(operation, { ...params, path: local }), local, String(params.path)) as Record<string, unknown>;
        }
      }
    },
  };
}
export type RemotePaths = ReturnType<typeof createRemotePaths>;
