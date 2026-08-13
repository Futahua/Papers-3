import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createThumbnailFrameStore,
  pngDimensions,
  thumbnailDescriptorKey,
} from '../../src/main/windows/thumbnailFrameStore';

/** A minimal valid PNG (signature + IHDR length 13 + IHDR data + crc). */
function png(width: number, height: number, seed = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const header = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    ihdr,
    Buffer.from([0, 0, 0, 0]), // crc (not validated by the store)
  ]);
  return Buffer.concat([header, Buffer.from([seed, seed, seed, seed])]);
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('thumbnailFrameStore', () => {
  it('put/get round-trips a validated frame and rejects malformed input', () => {
    const dir = tempDir('frames-');
    try {
      const store = createThumbnailFrameStore({ dir });
      const key = 'a'.repeat(64);
      const frame = png(24, 14, 7);
      store.put(key, frame);
      const got = store.get(key);
      expect(got).toBeTruthy();
      expect([...got!]).toEqual([...frame]);
      expect(pngDimensions(got!)).toEqual({ width: 24, height: 14 });
      // Malformed writes are rejected; malformed reads return null.
      store.put(key, Buffer.from('not a png'));
      expect([...store.get(key)!]).toEqual([...frame]);
      expect(store.get('b'.repeat(64))).toBeNull();
      store.put('nonsense', frame);
      expect(store.get('nonsense')).toBeNull();
      store.delete(key);
      expect(store.get(key)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the key is a bounded 64-hex hash, never identity text', () => {
    const key = thumbnailDescriptorKey({ title: 'Window A', executableFingerprint: 'f'.repeat(64) });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('Window A');
    const other = thumbnailDescriptorKey({ title: 'Window B', executableFingerprint: 'f'.repeat(64) });
    expect(key).not.toEqual(other);
  });

  it('bounded LRU eviction and total-size cap', () => {
    const dir = tempDir('frames-');
    try {
      const store = createThumbnailFrameStore({ dir, maxFrames: 3 });
      for (let i = 0; i < 5; i += 1) {
        store.put(String(i).repeat(64), png(16, 16, i));
      }
      const files = fs.readdirSync(dir).filter((name) => name.endsWith('.png'));
      expect(files).toHaveLength(3);
      expect(store.get('0'.repeat(64))).toBeNull();
      expect(store.get('4'.repeat(64))).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clear removes every frame; a failing dir yields a no-op store', () => {
    const dir = tempDir('frames-');
    try {
      const store = createThumbnailFrameStore({ dir });
      store.put('c'.repeat(64), png(10, 10));
      store.clear();
      expect(store.get('c'.repeat(64))).toBeNull();
      const bad = createThumbnailFrameStore({ dir: path.join(dir, 'no', 'such', 'deep', 'path') });
      expect(() => { bad.put('d'.repeat(64), png(10, 10)); bad.get('d'.repeat(64)); }).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
