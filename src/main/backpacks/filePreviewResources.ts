import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';

export const FILE_PREVIEW_SCHEME = 'papers-file-preview';

const RESOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDLE_MS = 30 * 60_000;
const MAX_RESOURCES = 512;

interface PreviewResourceRecord {
  id: string;
  backpackId: string;
  filePath: string;
  mime: string;
  touchedAt: number;
  cleanup?: () => void | Promise<void>;
}

export interface FilePreviewGrant {
  id: string;
  url: string;
}

export interface FilePreviewResourceRegistry {
  grant(
    backpackId: string,
    filePath: string,
    mime: string,
    cleanup?: () => void | Promise<void>,
  ): FilePreviewGrant;
  resolve(backpackId: string, id: string): PreviewResourceRecord | null;
  revoke(backpackId: string, id: string): boolean;
  dispose(): Promise<void>;
}

function cleanupRecord(record: PreviewResourceRecord): void {
  if (!record.cleanup) return;
  void Promise.resolve(record.cleanup()).catch(() => undefined);
}

export function createFilePreviewResourceRegistry(now: () => number = Date.now): FilePreviewResourceRegistry {
  const resources = new Map<string, PreviewResourceRecord>();

  const prune = (): void => {
    const cutoff = now() - MAX_IDLE_MS;
    for (const [id, record] of resources) {
      if (record.touchedAt >= cutoff) continue;
      resources.delete(id);
      cleanupRecord(record);
    }
    while (resources.size > MAX_RESOURCES) {
      const oldest = resources.entries().next().value as [string, PreviewResourceRecord] | undefined;
      if (!oldest) break;
      resources.delete(oldest[0]);
      cleanupRecord(oldest[1]);
    }
  };

  return {
    grant(backpackId, filePath, mime, cleanup) {
      prune();
      const id = randomUUID();
      const normalized = path.resolve(filePath);
      resources.set(id, {
        id,
        backpackId,
        filePath: normalized,
        mime,
        touchedAt: now(),
        cleanup,
      });
      return {
        id,
        url: `${FILE_PREVIEW_SCHEME}://${backpackId}/${id}/${encodeURIComponent(path.basename(normalized) || 'preview')}`,
      };
    },

    resolve(backpackId, id) {
      prune();
      if (!RESOURCE_ID_PATTERN.test(id)) return null;
      const record = resources.get(id);
      if (!record || record.backpackId !== backpackId) return null;
      record.touchedAt = now();
      return record;
    },

    revoke(backpackId, id) {
      const record = resources.get(id);
      if (!record || record.backpackId !== backpackId) return false;
      resources.delete(id);
      cleanupRecord(record);
      return true;
    },

    async dispose() {
      const records = [...resources.values()];
      resources.clear();
      await Promise.all(records.map(async (record) => {
        if (!record.cleanup) return;
        await Promise.resolve(record.cleanup()).catch(() => undefined);
      }));
    },
  };
}

type ByteRange = { start: number; end: number };

function parseSingleRange(raw: string | null, size: number): ByteRange | null | 'invalid' {
  if (!raw) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!match) return 'invalid';

  const left = match[1] ?? '';
  const right = match[2] ?? '';
  if (!left && !right) return 'invalid';

  if (!left) {
    const suffix = Number(right);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(left);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return 'invalid';
  const requestedEnd = right ? Number(right) : size - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return 'invalid';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function denied(status: number, reason: string): Response {
  return new Response(`Denied: ${reason}`, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function createFilePreviewProtocolHandler(
  registry: FilePreviewResourceRegistry,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return denied(405, 'method not allowed');
    }

    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      return denied(400, 'malformed preview URL');
    }

    const backpackId = parsed.hostname;
    const id = decodeURIComponent(parsed.pathname.split('/').filter(Boolean)[0] ?? '');
    const record = registry.resolve(backpackId, id);
    if (!record) return denied(404, 'preview resource unavailable');

    let stat;
    try {
      stat = await fs.stat(record.filePath);
      if (!stat.isFile()) return denied(404, 'preview resource is not a file');
    } catch {
      return denied(404, 'preview resource missing');
    }

    const size = stat.size;
    const range = parseSingleRange(request.headers.get('range'), size);
    if (range === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: {
          'content-range': `bytes */${size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        },
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, size - 1);
    const length = size === 0 ? 0 : end - start + 1;
    const headers = new Headers({
      'content-type': record.mime,
      'content-length': String(length),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(record.filePath))}`,
    });
    if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);

    if (request.method === 'HEAD' || size === 0) {
      return new Response(null, { status: range ? 206 : 200, headers });
    }

    const body = Readable.toWeb(createReadStream(record.filePath, { start, end }));
    return new Response(body as unknown as BodyInit, {
      status: range ? 206 : 200,
      headers,
    });
  };
}
