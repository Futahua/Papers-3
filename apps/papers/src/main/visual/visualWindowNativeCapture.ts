import { desktopCapturer, type DesktopCapturerSource, type NativeImage } from 'electron';

import { VISUAL_ARTIFACT_MAX_BYTES } from './visualArtifactStore';

const MAX_DIMENSION = 8192;

export interface VisualNativeWindowCapture {
  bytes: Uint8Array;
  width: number;
  height: number;
  sourceId: string;
}

export interface VisualWindowSourceProvider {
  getSources(options: {
    types: Array<'window'>;
    thumbnailSize: { width: number; height: number };
    fetchWindowIcons: false;
  }): Promise<DesktopCapturerSource[]>;
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_DIMENSION;
}

function validSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function imageBytes(thumbnail: NativeImage): { bytes: Uint8Array; width: number; height: number } | null {
  try {
    const bytes = thumbnail.toPNG();
    const size = thumbnail.getSize();
    if (bytes.byteLength < 1 || bytes.byteLength > VISUAL_ARTIFACT_MAX_BYTES
      || !validDimension(size.width) || !validDimension(size.height)) return null;
    return { bytes: new Uint8Array(bytes), width: size.width, height: size.height };
  } catch {
    return null;
  }
}

/** Exact native-window source lookup. The source id is supplied by the
 * main-owned BaseWindow and matched byte-for-byte; no title, focus, ordering,
 * or window-handle guessing is involved. */
export function createVisualWindowNativeCaptureService(
  sourceProvider: VisualWindowSourceProvider = desktopCapturer,
): {
  request(sourceId: string, requestSize: { width: number; height: number }, timeoutMs?: number): Promise<VisualNativeWindowCapture | null>;
} {
  return {
    async request(sourceId, requestSize, timeoutMs = 2000) {
      if (!validSourceId(sourceId) || !validDimension(requestSize.width) || !validDimension(requestSize.height)
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const sources = await Promise.race([
          sourceProvider.getSources({
            types: ['window'],
            thumbnailSize: { width: requestSize.width, height: requestSize.height },
            fetchWindowIcons: false,
          }),
          new Promise<DesktopCapturerSource[]>((resolve) => {
            timer = setTimeout(() => resolve([]), timeoutMs);
          }),
        ]);
        const source = sources.find((candidate) => candidate.id === sourceId);
        if (!source) return null;
        const image = imageBytes(source.thumbnail);
        return image ? { ...image, sourceId: source.id } : null;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
