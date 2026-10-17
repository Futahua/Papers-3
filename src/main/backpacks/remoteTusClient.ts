import { Upload, type HttpStack } from 'tus-js-client';
import { createReadStream, promises as fs } from 'node:fs';
import { AtomicJsonStore } from '../persistence/atomicStore';

/** Thin adapter: tus-js-client owns offsets, chunk retries and resume negotiation. */
export async function uploadWithTus(options: {
  address: string; token: string; file: string; folderId: string; name: string;
  size: number; sha256: string; journal: string;
  httpStack?: HttpStack;
}) {
  const base = new URL(options.address), endpoint = new URL('/v1/files/transfers', base).href;
  const store = new AtomicJsonStore(options.journal, { recoveryDir: options.journal + '.recovery' });
  type Previous = Awaited<ReturnType<Upload['findPreviousUploads']>>[number];
  const valid = (url: string) => {
    const u = new URL(url, base);
    if (u.origin !== base.origin || !/^\/v1\/files\/transfers\/(?:[a-f0-9]{32}|[a-f0-9-]{36})$/.test(u.pathname) || u.search || u.hash || u.username || u.password) throw Error('Invalid resumable upload location');
    return u.href;
  };
  const before = await fs.stat(options.file);
  if (!before.isFile() || before.size !== options.size) throw Error('Source changed before upload');
  const retained = await store.load<{ upload: Previous }>();
  const input = createReadStream(options.file); input.on('error', () => {});
  const upload = new Upload(input as unknown as Buffer, {
    ...(options.httpStack?{httpStack:options.httpStack}:{}),
    endpoint, uploadSize: options.size, chunkSize: 4 * 1024 ** 2,
    metadata: { folderId: options.folderId, name: options.name, sha256: options.sha256 },
    retryDelays: [0, 1000, 3000, 10000], headers: { Authorization: 'Bearer ' + options.token },
    fingerprint: async () => options.journal, removeFingerprintOnSuccess: false,
    urlStorage: {
      findAllUploads: async () => retained.value ? [retained.value.upload] : [],
      findUploadsByFingerprint: async () => retained.value ? [retained.value.upload] : [],
      addUpload: async (_key, previous) => { previous.uploadUrl = valid(previous.uploadUrl!); await store.save({ upload: previous }); return options.journal; },
      removeUpload: async () => { /* Retain completion identity until the caller confirms publication. */ },
    },
    onBeforeRequest: async request => {
      const url = request.getURL(); if (url !== endpoint) valid(url);
      const current = await fs.stat(options.file);
      if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) throw Error('Source changed during upload');
    },
  });
  if (retained.value) { valid(retained.value.upload.uploadUrl!); upload.resumeFromPreviousUpload(retained.value.upload); }
  try {
    await new Promise<void>((resolve, reject) => { upload.options.onSuccess = () => resolve(); upload.options.onError = reject; upload.start(); });
    return valid(upload.url!);
  } finally { input.destroy(); }
}
