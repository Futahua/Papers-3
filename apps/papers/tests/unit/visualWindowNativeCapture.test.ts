import { describe, expect, it, vi } from 'vitest';

import { createVisualWindowNativeCaptureService } from '../../src/main/visual/visualWindowNativeCapture';

function source(id: string, bytes = 'png-bytes', width = 73, height = 41) {
  return {
    id,
    thumbnail: {
      toPNG: () => Buffer.from(bytes),
      getSize: () => ({ width, height }),
    },
  } as never;
}

describe('visual native window capture', () => {
  it('matches the exact opaque source id and returns actual dimensions and bytes', async () => {
    const getSources = vi.fn(async () => [source('window:other:0'), source('window:101:1')]);
    const service = createVisualWindowNativeCaptureService({ getSources });
    await expect(service.request('window:101:1', { width: 640, height: 480 })).resolves.toMatchObject({
      sourceId: 'window:101:1', width: 73, height: 41, bytes: new Uint8Array(Buffer.from('png-bytes')),
    });
    expect(getSources).toHaveBeenCalledWith({
      types: ['window'], thumbnailSize: { width: 640, height: 480 }, fetchWindowIcons: false,
    });
    await expect(service.request('window:not-present:1', { width: 640, height: 480 })).resolves.toBeNull();
  });

  it('times out a source enumeration and refuses invalid bounds', async () => {
    const getSources = vi.fn(() => new Promise<never>(() => undefined));
    const service = createVisualWindowNativeCaptureService({ getSources });
    await expect(service.request('window:101:1', { width: 10, height: 10 }, 1)).resolves.toBeNull();
    await expect(service.request('window:101:1', { width: 0, height: 10 })).resolves.toBeNull();
  });
});
