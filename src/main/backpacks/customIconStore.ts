import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Custom pictures the creator gives real files and folders, kept on the device that owns them so every
 * device browsing that folder (here, or remotely through the gateway) shows the same picture.
 * Keyed by the owner's absolute path; a renamed or moved item loses its picture.
 */
export const CUSTOM_ICON_MAX_BYTES = 256 * 1024;
const MAX_ICONS = 4000;
const ICON = /^data:image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon|bmp|avif);base64,[A-Za-z0-9+/=]+$/;

export function validCustomIcon(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > CUSTOM_ICON_MAX_BYTES || !ICON.test(value)) throw Error('The picture must be a small image.');
  return value;
}

export interface CustomIconStore {
  /** Pictures of the direct children of `folder`, by child name. */
  inFolder(folder: string): Promise<Record<string, string>>;
  /** Sets (or with null, removes) the picture of each path. */
  set(paths: string[], icon: string | null): Promise<void>;
}

export function createCustomIconStore(file: string, options: { caseInsensitive?: boolean } = {}): CustomIconStore {
  const fold = options.caseInsensitive ?? process.platform === 'win32';
  const key = (value: string) => { const resolved = path.resolve(value).replace(/[\\/]+$/, '') || path.resolve(value); return fold ? resolved.toLocaleLowerCase() : resolved; };
  let icons: Map<string, { path: string; icon: string }> | null = null;
  let writing: Promise<void> = Promise.resolve();
  const load = async () => {
    if (icons) return icons;
    const next = new Map<string, { path: string; icon: string }>();
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { icons?: Record<string, unknown> };
      for (const [itemPath, icon] of Object.entries(raw.icons ?? {})) try { const valid = validCustomIcon(icon); if (valid) next.set(key(itemPath), { path: itemPath, icon: valid }); } catch {}
    } catch {}
    return icons = next;
  };
  const save = () => writing = writing.then(async () => {
    const out: Record<string, string> = {};
    for (const { path: itemPath, icon } of icons!.values()) out[itemPath] = icon;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ version: 1, icons: out }));
    await fs.rename(temporary, file);
  });
  return {
    async inFolder(folder) {
      const all = await load(), parent = key(folder), out: Record<string, string> = {};
      for (const [itemKey, { path: itemPath, icon }] of all) if (key(path.dirname(itemKey)) === parent && itemKey !== parent) out[path.basename(itemPath)] = icon;
      return out;
    },
    async set(paths, icon) {
      const valid = validCustomIcon(icon), all = await load();
      for (const itemPath of paths) {
        if (typeof itemPath !== 'string' || !path.isAbsolute(itemPath)) throw Error('Choose a file or folder on this device.');
        if (valid) all.set(key(itemPath), { path: path.resolve(itemPath), icon: valid }); else all.delete(key(itemPath));
      }
      if (all.size > MAX_ICONS) throw Error('Too many custom pictures on this device.');
      await save();
    },
  };
}
