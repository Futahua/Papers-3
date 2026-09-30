import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createFileCapabilityService } from '../../src/main/backpacks/fileCapabilityService';
import type { EverythingSearchBridge } from '../../src/main/backpacks/everythingSearchBridge';
import type { RevitPreviewBridge } from '../../src/main/backpacks/revitPreviewBridge';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-file-capability-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function service(
  everythingSearch: EverythingSearchBridge | null = null,
  revitPreview: RevitPreviewBridge | null = null,
) {
  return createFileCapabilityService({
    everythingSearch,
    revitPreview,
    dopusrtPath: null,
    libreOfficePath: null,
    openPath: vi.fn(async () => ''),
    revealPath: vi.fn(),
  });
}

describe('file capability service', () => {
  it('describes and lists real filesystem entries with a stable identity hint', async () => {
    const folder = path.join(root, 'folder');
    const file = path.join(folder, 'alpha.txt');
    await fs.mkdir(folder);
    await fs.writeFile(file, 'hello');

    const stat = await service().call({ operation: 'stat', params: { path: file } });
    expect(stat.ok).toBe(true);
    expect(stat.entry).toMatchObject({
      path: file,
      name: 'alpha.txt',
      kind: 'file',
      extension: '.txt',
      size: 5,
    });
    expect(typeof (stat.entry as { identity: unknown }).identity).toBe('string');

    const listed = await service().call({ operation: 'list', params: { path: folder } });
    expect(listed.ok).toBe(true);
    expect((listed.items as Array<{ path: string }>).map((entry) => entry.path)).toEqual([file]);
  });

  it('previews text and never leaves an unknown binary unsupported', async () => {
    const textFile = path.join(root, 'notes.md');
    const binaryFile = path.join(root, 'sample.weird');
    await fs.writeFile(textFile, '# hello\nworld');
    await fs.writeFile(binaryFile, Buffer.from([0, 1, 2, 3, 65, 66, 67, 68, 69, 70, 0xff]));

    const text = await service().call({ operation: 'preview', params: { path: textFile } });
    expect(text.ok).toBe(true);
    expect(text.preview).toMatchObject({ kind: 'text', text: '# hello\nworld', truncated: false });

    const binary = await service().call({ operation: 'preview', params: { path: binaryFile } });
    expect(binary.ok).toBe(true);
    expect(binary.preview).toMatchObject({ kind: 'binary', truncated: false });
    expect((binary.preview as { hex: string }).hex).toContain('00000000');
  });

  it('uses an embedded Revit preview before the binary fallback', async () => {
    const target = path.join(root, 'model.rvt');
    await fs.writeFile(target, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const preview = vi.fn(async () => ({ ok: true as const, png }));
    const bridge: RevitPreviewBridge = { preview };

    const result = await service(null, bridge).call({ operation: 'preview', params: { path: target } });

    expect(preview).toHaveBeenCalledWith(target);
    expect(result.ok).toBe(true);
    expect(result.preview).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      extractedBy: 'revit-embedded-preview',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    });
  });

  it('delegates global search to the Everything bridge', async () => {
    const search = vi.fn(async () => ({
      ok: true as const,
      provider: 'everything' as const,
      version: '1.4.1.1032',
      total: 1,
      results: [{
        path: 'D:\\one.txt',
        name: 'one.txt',
        kind: 'file' as const,
        size: 1,
        modifiedAt: 1,
        attributes: 0,
      }],
    }));
    const bridge: EverythingSearchBridge = { search };

    const result = await service(bridge).call({ operation: 'search', params: { query: 'one', limit: 25 } });
    expect(search).toHaveBeenCalledWith('one', 25);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(1);
  });

  it('fails closed when Directory Opus is unavailable for mutations', async () => {
    const target = path.join(root, 'one.txt');
    await fs.writeFile(target, 'x');
    const result = await service().call({
      operation: 'delete',
      params: { paths: [target] },
    });
    expect(result).toEqual({
      ok: false,
      code: 'DOPUS_UNAVAILABLE',
      message: 'Directory Opus is unavailable.',
    });
    expect(await fs.readFile(target, 'utf8')).toBe('x');
  });

  it('refuses relative paths and oversized batches before touching the filesystem', async () => {
    const relative = await service().call({ operation: 'stat', params: { path: 'relative.txt' } });
    expect(relative.ok).toBe(false);
    expect(relative.code).toBe('FILE_OPERATION_FAILED');

    const tooMany = Array.from({ length: 65 }, (_, index) => path.join(root, `${index}.txt`));
    const mutation = await service().call({ operation: 'delete', params: { paths: tooMany } });
    expect(mutation.ok).toBe(false);
    expect(mutation.code).toBe('FILE_OPERATION_FAILED');
  });
});
