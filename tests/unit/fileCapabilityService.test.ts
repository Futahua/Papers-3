import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createFileCapabilityService } from '../../src/main/backpacks/fileCapabilityService';
import { createFilePreviewResourceRegistry } from '../../src/main/backpacks/filePreviewResources';
import type { EverythingSearchBridge } from '../../src/main/backpacks/everythingSearchBridge';
import type { PdfPreviewHostBridge } from '../../src/main/backpacks/pdfPreviewHostBridge';
import type { RevitPreviewBridge } from '../../src/main/backpacks/revitPreviewBridge';
import type { ShellThumbnailBridge } from '../../src/main/backpacks/shellThumbnailBridge';
import type { CalibrePreviewBridge } from '../../src/main/backpacks/calibrePreviewBridge';
import type { AutoCadPreviewBridge } from '../../src/main/backpacks/autoCadPreviewBridge';
import type { WindowsPreviewHandlerBridge } from '../../src/main/backpacks/windowsPreviewHandlerBridge';

let root: string;
const CONTEXT = { backpackId: 'bp-11111111-2222-4333-8444-555555555555' };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-file-capability-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function service(
  everythingSearch: EverythingSearchBridge | null = null,
  revitPreview: RevitPreviewBridge | null = null,
  windowsPreview: WindowsPreviewHandlerBridge | null = null,
  context: Record<string, unknown> = CONTEXT,
  pdfPreview: PdfPreviewHostBridge | null = null,
  shellThumbnail: ShellThumbnailBridge | null = null,
  calibrePreview: CalibrePreviewBridge | null = null,
  autoCadPreview: AutoCadPreviewBridge | null = null,
) {
  const previewResources = createFilePreviewResourceRegistry();
  const inner = createFileCapabilityService({
    everythingSearch,
    previewResources,
    pdfPreview,
    revitPreview,
    shellThumbnail,
    calibrePreview,
    autoCadPreview,
    windowsPreview,
    dopusrtPath: null,
    libreOfficePath: null,
    openPath: vi.fn(async () => ''),
    revealPath: vi.fn(),
  });
  return {
    call: (request: unknown) => inner.call(request, context as typeof CONTEXT),
    previewResources,
  };
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
    expect(text.preview).toMatchObject({
      kind: 'text',
      text: '# hello\nworld',
      byteOffset: 0,
      nextOffset: Buffer.byteLength('# hello\nworld'),
      eof: true,
    });

    const binary = await service().call({ operation: 'preview', params: { path: binaryFile } });
    expect(binary.ok).toBe(true);
    expect(binary.preview).toMatchObject({ kind: 'binary', truncated: false });
    expect((binary.preview as { hex: string }).hex).toContain('00000000');
  });

  it('streams rich previews regardless of file size instead of imposing the old IPC ceiling', async () => {
    const target = path.join(root, 'large.png');
    await fs.writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.truncate(target, 32 * 1024 * 1024);

    const previewService = service();
    const result = await previewService.call({ operation: 'preview', params: { path: target } });

    expect(result.ok).toBe(true);
    expect(result.preview).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      transport: 'stream',
    });
    const preview = result.preview as { url: string; resourceId: string; dataUrl?: string };
    expect(preview.url).toMatch(/^papers-file-preview:\/\/bp-11111111-2222-4333-8444-555555555555\//);
    expect(preview.dataUrl).toBeUndefined();

    const released = await previewService.call({
      operation: 'preview-release',
      params: { resourceId: preview.resourceId },
    });
    expect(released).toEqual({ ok: true, released: true });
  });

  it('treats the text preview size as a chunk size and can continue through the file', async () => {
    const target = path.join(root, 'large.log');
    const chunkBytes = 2 * 1024 * 1024;
    const tail = 'TAIL-CONTINUES';
    await fs.writeFile(target, 'a'.repeat(chunkBytes) + tail);

    const previewService = service();
    const first = await previewService.call({ operation: 'preview', params: { path: target } });
    expect(first.ok).toBe(true);
    expect(first.preview).toMatchObject({
      kind: 'text',
      byteOffset: 0,
      nextOffset: chunkBytes,
      eof: false,
    });
    expect((first.preview as { text: string }).text.length).toBe(chunkBytes);

    const second = await previewService.call({
      operation: 'preview-text-chunk',
      params: { path: target, offset: chunkBytes },
    });
    expect(second).toMatchObject({
      ok: true,
      byteOffset: chunkBytes,
      nextOffset: chunkBytes + Buffer.byteLength(tail),
      eof: true,
      text: tail,
    });
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

  it('prefers a high-resolution Windows Shell thumbnail over the embedded Revit fallback', async () => {
    const target = path.join(root, 'model.rvt');
    await fs.writeFile(target, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const shellPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
    const embeddedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const shellPreview = vi.fn(async () => ({
      ok: true as const,
      png: shellPng,
      width: 1600,
      height: 1600,
    }));
    const embeddedPreview = vi.fn(async () => ({ ok: true as const, png: embeddedPng }));
    const shell: ShellThumbnailBridge = { preview: shellPreview };
    const revit: RevitPreviewBridge = { preview: embeddedPreview };

    const result = await service(null, revit, null, CONTEXT, null, shell).call({
      operation: 'preview',
      params: { path: target },
    });

    expect(shellPreview).toHaveBeenCalledWith(target, 1600);
    expect(embeddedPreview).not.toHaveBeenCalled();
    expect(result.preview).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      extractedBy: 'windows-shell-thumbnail',
      width: 1600,
      height: 1600,
      dataUrl: `data:image/png;base64,${shellPng.toString('base64')}`,
    });
  });

  it('uses a generic Windows Shell thumbnail for installed-format renderers such as DWG', async () => {
    const target = path.join(root, 'drawing.dwg');
    await fs.writeFile(target, Buffer.from([0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0]));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
    const preview = vi.fn(async () => ({
      ok: true as const,
      png,
      width: 256,
      height: 126,
    }));
    const shell: ShellThumbnailBridge = { preview };

    const result = await service(null, null, null, CONTEXT, null, shell).call({
      operation: 'preview',
      params: { path: target },
    });

    expect(result.preview).toMatchObject({
      kind: 'image',
      extractedBy: 'windows-shell-thumbnail',
      width: 256,
      height: 126,
    });
  });

  it('prefers AutoCAD rendering over the lower-resolution Shell thumbnail for DWG', async () => {
    const target = path.join(root, 'drawing.dwg');
    await fs.writeFile(target, Buffer.from([0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0]));
    const cadPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8, 8, 8]);
    const shellPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1]);
    const cadPreview = vi.fn(async () => ({
      ok: true as const,
      png: cadPng,
      width: 942,
      height: 534,
      provider: 'AutoCAD 2023',
    }));
    const autoCad: AutoCadPreviewBridge = {
      supports: vi.fn((extension: string) => extension === '.dwg'),
      preview: cadPreview,
    };
    const shellPreview = vi.fn(async () => ({
      ok: true as const,
      png: shellPng,
      width: 256,
      height: 126,
    }));
    const shell: ShellThumbnailBridge = { preview: shellPreview };

    const result = await service(null, null, null, CONTEXT, null, shell, null, autoCad).call({
      operation: 'preview',
      params: { path: target },
    });

    expect(cadPreview).toHaveBeenCalledWith(target);
    expect(shellPreview).not.toHaveBeenCalled();
    expect(result.preview).toMatchObject({
      kind: 'image',
      extractedBy: 'autocad-core-console',
      provider: 'AutoCAD 2023',
      width: 942,
      height: 534,
      dataUrl: `data:image/png;base64,${cadPng.toString('base64')}`,
    });
  });

  it('uses Calibre capabilities for readable ebook formats instead of the binary fallback', async () => {
    const target = path.join(root, 'book.epub');
    const converted = path.join(root, 'book-preview.pdf');
    await fs.writeFile(target, 'epub-placeholder');
    await fs.writeFile(converted, '%PDF-1.7\nbook');
    const cleanup = vi.fn(async () => {});
    const supports = vi.fn((extension: string) => extension === '.epub');
    const convertToPdf = vi.fn(async () => ({
      ok: true as const,
      filePath: converted,
      cleanup,
    }));
    const calibre: CalibrePreviewBridge = {
      supports,
      convertToPdf,
      formats: Object.freeze(['.azw3', '.cbz', '.epub', '.mobi']),
    };
    const previewService = service(null, null, null, CONTEXT, null, null, calibre);

    const result = await previewService.call({ operation: 'preview', params: { path: target } });

    expect(supports).toHaveBeenCalledWith('.epub');
    expect(convertToPdf).toHaveBeenCalledWith(target);
    expect(result.preview).toMatchObject({
      kind: 'pdf',
      mime: 'application/pdf',
      transport: 'stream',
      convertedBy: 'calibre',
      sourceFormat: '.epub',
    });
    const resourceId = (result.preview as { resourceId: string }).resourceId;
    expect((await previewService.call({ operation: 'preview-release', params: { resourceId } })).released).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('prefers an installed Windows preview handler for non-text files and controls one sender-owned live host', async () => {
    const target = path.join(root, 'document.docx');
    await fs.writeFile(target, 'office-placeholder');
    const probe = vi.fn(async () => ({ available: true, clsid: '{84f66100-ff7c-4fb4-b0c0-02cd7fb668fe}' }));
    const open = vi.fn(async () => ({ ok: true as const, sessionId: '11111111-2222-4333-8444-555555555555', clsid: '{84f66100-ff7c-4fb4-b0c0-02cd7fb668fe}' }));
    const move = vi.fn(() => true);
    const focus = vi.fn(() => true);
    const close = vi.fn(() => true);
    const bridge: WindowsPreviewHandlerBridge = {
      probe, open, move, focus, close,
      setOwnerSurfaceBounds: vi.fn(), setOwnerVisible: vi.fn(), closeOwner: vi.fn(), dispose: vi.fn(),
    };
    const nativePreviewHost = {
      ownerKey: '7:surface-a',
      parentHwnd: '12345',
      surfaceBounds: { x: 40, y: 70, width: 800, height: 600 },
    };
    const previewService = service(null, null, bridge, { ...CONTEXT, nativePreviewHost });

    const preview = await previewService.call({ operation: 'preview', params: { path: target } });
    expect(probe).toHaveBeenCalledWith(target);
    expect(preview.preview).toMatchObject({ kind: 'windows-preview-handler', provider: 'windows-preview-handler' });

    const rect = { x: 300, y: 80, width: 420, height: 460 };
    const opened = await previewService.call({ operation: 'preview-native-open', params: { path: target, rect } });
    expect(opened.ok).toBe(true);
    expect(open).toHaveBeenCalledWith(nativePreviewHost, target, rect);
    const sessionId = (opened as { sessionId: string }).sessionId;
    expect((await previewService.call({ operation: 'preview-native-move', params: { sessionId, rect } })).ok).toBe(true);
    expect(move).toHaveBeenCalledWith(nativePreviewHost.ownerKey, sessionId, rect);
    expect((await previewService.call({ operation: 'preview-native-focus', params: { sessionId } })).ok).toBe(true);
    expect(focus).toHaveBeenCalledWith(nativePreviewHost.ownerKey, sessionId);
    expect((await previewService.call({ operation: 'preview-native-close', params: { sessionId } })).ok).toBe(true);
    expect(close).toHaveBeenCalledWith(nativePreviewHost.ownerKey, sessionId);
  });

  it('routes PDFs through a sender-owned top-level preview host instead of the nested renderer iframe path', async () => {
    const target = path.join(root, 'document.pdf');
    await fs.writeFile(target, '%PDF-1.7\npreview');
    const open = vi.fn(async (
      _context,
      _url: string,
      _rect,
      cleanup: () => void,
    ) => {
      (open as typeof open & { cleanup?: () => void }).cleanup = cleanup;
      return { ok: true as const, sessionId: '11111111-2222-4333-8444-555555555555' };
    });
    const move = vi.fn(() => true);
    const close = vi.fn(() => true);
    const pdfPreview: PdfPreviewHostBridge = {
      open,
      move,
      close,
      setOwnerSurfaceBounds: vi.fn(),
      setOwnerVisible: vi.fn(),
      closeOwner: vi.fn(),
      raiseWindow: vi.fn(),
      dispose: vi.fn(),
    };
    const nativePreviewHost = {
      ownerKey: '7:surface-a',
      parentHwnd: '12345',
      surfaceBounds: { x: 40, y: 70, width: 800, height: 600 },
    };
    const previewService = service(
      null,
      null,
      null,
      { ...CONTEXT, nativePreviewHost },
      pdfPreview,
    );

    const preview = await previewService.call({ operation: 'preview', params: { path: target } });
    expect(preview.preview).toMatchObject({
      kind: 'hosted-pdf',
      mime: 'application/pdf',
      transport: 'stream',
    });
    const resourceId = (preview.preview as { resourceId: string }).resourceId;
    const rect = { x: 300, y: 80, width: 420, height: 460 };
    const opened = await previewService.call({
      operation: 'preview-pdf-open',
      params: { resourceId, rect },
    });
    expect(opened).toMatchObject({ ok: true, sessionId: '11111111-2222-4333-8444-555555555555' });
    expect(open).toHaveBeenCalledWith(
      nativePreviewHost,
      expect.stringMatching(/^papers-file-preview:\/\/bp-11111111-2222-4333-8444-555555555555\//),
      rect,
      expect.any(Function),
    );

    const sessionId = (opened as { sessionId: string }).sessionId;
    expect((await previewService.call({ operation: 'preview-pdf-move', params: { sessionId, rect } })).ok).toBe(true);
    expect(move).toHaveBeenCalledWith(nativePreviewHost.ownerKey, sessionId, rect);
    expect((await previewService.call({ operation: 'preview-pdf-close', params: { sessionId } })).ok).toBe(true);
    expect(close).toHaveBeenCalledWith(nativePreviewHost.ownerKey, sessionId);

    (open as typeof open & { cleanup?: () => void }).cleanup?.();
    const released = await previewService.call({ operation: 'preview-release', params: { resourceId } });
    expect(released).toEqual({ ok: true, released: false });
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
