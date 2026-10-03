import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createFilePreviewProtocolHandler,
  createFilePreviewResourceRegistry,
} from '../../src/main/backpacks/filePreviewResources';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-preview-resource-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('file preview resource protocol', () => {
  it('streams full and ranged responses without loading the file into the IPC payload', async () => {
    const file = path.join(root, 'large.pdf');
    await fs.writeFile(file, Buffer.from('0123456789', 'utf8'));
    const registry = createFilePreviewResourceRegistry();
    const grant = registry.grant('bp-11111111-2222-4333-8444-555555555555', file, 'application/pdf');
    const handler = createFilePreviewProtocolHandler(registry);

    const full = await handler(new Request(grant.url));
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe('10');
    expect(await full.text()).toBe('0123456789');

    const partial = await handler(new Request(grant.url, { headers: { range: 'bytes=2-5' } }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(partial.headers.get('content-length')).toBe('4');
    expect(await partial.text()).toBe('2345');

    const suffix = await handler(new Request(grant.url, { headers: { range: 'bytes=-3' } }));
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('789');
  });

  it('keeps opaque resources scoped to the Backpack that received the grant', async () => {
    const file = path.join(root, 'image.png');
    await fs.writeFile(file, 'image bytes');
    const registry = createFilePreviewResourceRegistry();
    const grant = registry.grant('bp-11111111-2222-4333-8444-555555555555', file, 'image/png');
    const handler = createFilePreviewProtocolHandler(registry);
    const parsed = new URL(grant.url);
    const foreign = new URL(grant.url);
    foreign.hostname = 'bp-99999999-2222-4333-8444-555555555555';

    expect((await handler(new Request(foreign))).status).toBe(404);

    const head = await handler(new Request(parsed, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength('image bytes')));
    expect(await head.text()).toBe('');
  });

  it('revokes resources and runs deferred cleanup exactly once', async () => {
    const file = path.join(root, 'converted.pdf');
    await fs.writeFile(file, 'pdf');
    const cleanup = vi.fn(async () => undefined);
    const registry = createFilePreviewResourceRegistry();
    const backpackId = 'bp-11111111-2222-4333-8444-555555555555';
    const grant = registry.grant(backpackId, file, 'application/pdf', cleanup);
    const handler = createFilePreviewProtocolHandler(registry);

    expect(registry.revoke(backpackId, grant.id)).toBe(true);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect((await handler(new Request(grant.url))).status).toBe(404);
    expect(registry.revoke(backpackId, grant.id)).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed and unsatisfiable ranges', async () => {
    const file = path.join(root, 'video.mp4');
    await fs.writeFile(file, '12345');
    const registry = createFilePreviewResourceRegistry();
    const grant = registry.grant('bp-11111111-2222-4333-8444-555555555555', file, 'video/mp4');
    const handler = createFilePreviewProtocolHandler(registry);

    const response = await handler(new Request(grant.url, { headers: { range: 'bytes=99-100' } }));
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */5');
  });
});
