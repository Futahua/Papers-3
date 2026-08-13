/**
 * 028 P3: bounded DURABLE validated-frame retention for window-layout member
 * previews. A member that has supplied real window content (a validated
 * non-uniform PNG) keeps that frame on disk so a MINIMIZED member can still
 * serve useful visual content even when the live DWM/PrintWindow capture fails
 * or the helper restarts - without depending only on the optional in-memory
 * cache. Frames are keyed by a SHA-256 of the STABLE member descriptor
 * (title + executableFingerprint), never by runtime ids/tokens/HWNDs; the PNG
 * is strictly validated (signature + size bounds) on write and read; the store
 * is bounded (LRU frame count + total bytes) with atomic temp+rename writes.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FRAME_STORE_MAX_FRAMES = 8;
export const FRAME_STORE_MAX_BYTES_PER_FRAME = 256 * 1024;
export const FRAME_STORE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const FRAME_MAX_WIDTH = 320;
export const FRAME_MAX_HEIGHT = 180;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ThumbnailFrameStore {
  put(descriptorKey: string, png: Buffer): void;
  get(descriptorKey: string): Buffer | null;
  delete(descriptorKey: string): void;
  clear(): void;
}

export interface ThumbnailFrameStoreOptions {
  dir: string;
  maxFrames?: number;
  maxBytesPerFrame?: number;
  maxTotalBytes?: number;
}

function isValidPng(data: Buffer, maxBytes: number): boolean {
  if (!Buffer.isBuffer(data) || data.length < 33 || data.length > maxBytes) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (data[i] !== PNG_SIGNATURE[i]) return false;
  }
  return data.readUInt32BE(8) === 13;
}

export function createThumbnailFrameStore(options: ThumbnailFrameStoreOptions): ThumbnailFrameStore {
  const maxFrames = options.maxFrames ?? FRAME_STORE_MAX_FRAMES;
  const maxBytes = options.maxBytesPerFrame ?? FRAME_STORE_MAX_BYTES_PER_FRAME;
  const maxTotal = options.maxTotalBytes ?? FRAME_STORE_MAX_TOTAL_BYTES;
  try {
    fs.mkdirSync(options.dir, { recursive: true });
  } catch {
    /* best effort: a failing dir yields a no-op store */
  }

  function safeName(descriptorKey: string): string | null {
    return /^[a-f0-9]{64}$/.test(descriptorKey) ? `${descriptorKey}.png` : null;
  }

  function listFrames(): Array<{ name: string; size: number; mtime: number }> {
    try {
      return fs.readdirSync(options.dir)
        .filter((name) => name.endsWith('.png') && name.length === 68)
        .map((name) => {
          const stat = fs.statSync(path.join(options.dir, name));
          return { name, size: stat.size, mtime: stat.mtimeMs };
        });
    } catch {
      return [];
    }
  }

  function evict(): void {
    let frames = listFrames();
    const total = frames.reduce((sum, frame) => sum + frame.size, 0);
    if (frames.length <= maxFrames && total <= maxTotal) return;
    frames.sort((a, b) => a.mtime - b.mtime);
    while (frames.length > 0 && (frames.length > maxFrames || frames.reduce((s, f) => s + f.size, 0) > maxTotal)) {
      const oldest = frames.shift();
      if (!oldest) break;
      try {
        fs.unlinkSync(path.join(options.dir, oldest.name));
      } catch {
        /* ignore */
      }
    }
  }

  return {
    put(descriptorKey: string, png: Buffer): void {
      const name = safeName(descriptorKey);
      if (!name || !isValidPng(png, maxBytes)) return;
      const target = path.join(options.dir, name);
      const temp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        fs.writeFileSync(temp, png);
        fs.renameSync(temp, target);
        evict();
      } catch {
        try {
          fs.unlinkSync(temp);
        } catch {
          /* ignore */
        }
      }
    },
    get(descriptorKey: string): Buffer | null {
      const name = safeName(descriptorKey);
      if (!name) return null;
      try {
        const data = fs.readFileSync(path.join(options.dir, name));
        return isValidPng(data, maxBytes) ? data : null;
      } catch {
        return null;
      }
    },
    delete(descriptorKey: string): void {
      const name = safeName(descriptorKey);
      if (!name) return;
      try {
        fs.unlinkSync(path.join(options.dir, name));
      } catch {
        /* ignore */
      }
    },
    clear(): void {
      for (const frame of listFrames()) {
        try {
          fs.unlinkSync(path.join(options.dir, frame.name));
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Stable, bounded, non-identifying key for a persisted member descriptor.
 * Never contains a runtime id, token, HWND, process path, or title text. */
export function thumbnailDescriptorKey(descriptor: { title: string; executableFingerprint?: string }): string {
  return createHash('sha256')
    .update(`${descriptor.title}\u0000${descriptor.executableFingerprint ?? ''}`, 'utf8')
    .digest('hex');
}

/** Reads the PNG IHDR dimensions with the same bounds the thumbnail contract
 * enforces (positive, within 320x180). Returns null on any malformed input. */
export function pngDimensions(png: Buffer): { width: number; height: number } | null {
  if (!Buffer.isBuffer(png) || png.length < 33 || png.readUInt32BE(8) !== 13) return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (width <= 0 || height <= 0 || width > FRAME_MAX_WIDTH || height > FRAME_MAX_HEIGHT) return null;
  return { width, height };
}
