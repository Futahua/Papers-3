import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
}
type Resolved = { ownerId: string; parts: string[]; entry: RemoteFileEntry | null };
type Call = (operation: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;

const LISTING_TTL_MS = 2_000;
const UNSUPPORTED = new Set(['open', 'reveal', 'native-drag', 'office-editor-open', 'office-editor-save', 'preview-markdown-obsidian', 'search']);

export function createRemotePaths(client: RemotePathClient, options: { iconDirectory: string; fileIcon: (target: string) => Promise<unknown> }) {
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
        for (const key of [...listings.keys()]) if (key.startsWith(ownerId + '|')) listings.delete(key);
        if (job.phase !== 'completed') throw new Error(job.error || `The device reported ${job.phase}.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('The device did not confirm the change.');
  }
  function sameOwner(paths: unknown[]): string {
    const owners = new Set(paths.map(value => parseRemotePath(value)?.ownerId ?? 'local'));
    if (owners.size !== 1 || owners.has('local')) throw Object.assign(new Error('Copying and moving between devices is not built yet.'), { code: 'CROSS_DEVICE_UNSUPPORTED' });
    return [...owners][0]!;
  }
  // Replace the materialized local path with the remote path wherever a result echoes it.
  function relabel(value: unknown, local: string, remote: string): unknown {
    if (typeof value === 'string') return value === local ? remote : value;
    if (Array.isArray(value)) return value.map(item => relabel(item, local, remote));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabel(item, local, remote)]));
    return value;
  }

  return {
    devices: () => client.snapshot().devices.map(device => ({ id: device.id, name: device.name, path: remotePath(device.id, []) })),
    /** Returns null when the request has nothing remote in it, so local handling continues. */
    async handle(operation: string, params: Record<string, unknown>, call: Call): Promise<Record<string, unknown> | null> {
      const paths = Array.isArray(params.paths) ? params.paths : [];
      if (![params.path, params.destination, ...paths].some(isRemotePath)) return null;
      if (UNSUPPORTED.has(operation)) return { ok: false, code: 'REMOTE_UNSUPPORTED', message: 'Not available for files on another device yet.' };
      switch (operation) {
        case 'stat': {
          const { ownerId, parts, entry } = await resolve(params.path);
          return { ok: true, entry: describe(ownerId, parts, entry) };
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
