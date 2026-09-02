import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createVisualArtifactStore, type VisualArtifactMetadata } from '../../src/main/visual/visualArtifactStore';
import { createVisualReport } from '../../src/main/visual/visualReport';

function storedZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)), bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

describe('visual reports', () => {
  it('creates a bounded self-contained ZIP with hashed evidence entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-report-'));
    const artifacts = createVisualArtifactStore(root, { ttlMs: 60_000 });
    const png = await artifacts.put(new Uint8Array([137, 80, 78, 71]), 'image/png');
    const report = await createVisualReport({
      process: { pid: 1, appInstanceId: 'instance-a' },
      snapshot: { schemaVersion: 1 },
      surface: { windowId: 4, surfaceId: 'surface-a', projectId: 'project-a' },
      lifecycle: [{
        sequence: 1, observedAt: '2026-09-02T00:00:00.000Z',
        target: { windowId: 4, surfaceId: 'surface-a' },
        payload: { kind: 'lifecycle', phase: 'first-paint' },
      }, {
        sequence: 2, observedAt: '2026-09-01T23:59:58.000Z',
        target: { windowId: 4, surfaceId: 'surface-a' },
        payload: { kind: 'lifecycle', phase: 'dom-ready' },
      }],
      diagnostics: [{
        sequence: 3, observedAt: '2026-09-02T00:00:00.500Z',
        target: { windowId: 4, surfaceId: 'surface-a' },
        payload: { kind: 'uncaught-error', message: 'inside-window' },
      }, {
        sequence: 4, observedAt: '2026-09-01T23:59:58.500Z',
        target: { windowId: 4, surfaceId: 'surface-a' },
        payload: { kind: 'uncaught-error', message: 'outside-window' },
      }],
      timeline: [],
      semanticElements: { elements: [{ key: 'canvas.root' }] },
      captureSurface: async () => ({ result: { captureId: 'capture-a', png }, png }),
      artifacts,
      now: () => new Date('2026-09-02T00:00:01.000Z'),
    }, {
      windowId: 4,
      surfaceId: 'surface-a',
      beforeMs: 1_000,
      elementKeys: [],
      include: {
        surfaceCapture: true, elementCaptures: false, semanticElements: true, recentLifecycle: true,
        recentDiagnostics: true, timeline: true,
      },
    });

    expect(report.size).toBeGreaterThan(0);
    expect(report.manifestSummary.entryCount).toBe(10);
    const reportBytes = (await artifacts.read(report.artifactId, 0, 1024 * 1024)).bytes;
    expect(createHash('sha256').update(reportBytes).digest('hex')).toBe(report.sha256);
    expect(reportBytes[0]).toBe(0x50);
    expect(reportBytes[1]).toBe(0x4b);
    const entries = storedZipEntries(reportBytes);
    expect([...entries.keys()]).toEqual(expect.arrayContaining([
      'manifest.json', 'process.json', 'snapshot.json', 'surface.json',
      'lifecycle.ndjson', 'diagnostics.ndjson', 'timeline.ndjson', 'elements.json',
      'surface-capture.json', 'surface.png',
    ]));
    expect(entries.get('surface.png')).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect([...entries.keys()].filter((name) => name.endsWith('.png'))).toHaveLength(1);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!)) as {
      entries: Array<{ name: string; size: number; sha256: string }>;
    };
    expect(manifest.entries).toHaveLength(9);
    expect(manifest.entries.find((entry) => entry.name === 'surface.png')?.size).toBe(4);
    for (const entry of manifest.entries) {
      expect(createHash('sha256').update(entries.get(entry.name)!).digest('hex')).toBe(entry.sha256);
    }
    expect(new TextDecoder().decode(entries.get('lifecycle.ndjson'))).toContain('first-paint');
    expect(new TextDecoder().decode(entries.get('lifecycle.ndjson'))).not.toContain('dom-ready');
    expect(new TextDecoder().decode(entries.get('diagnostics.ndjson'))).toContain('inside-window');
    expect(new TextDecoder().decode(entries.get('diagnostics.ndjson'))).not.toContain('outside-window');
    expect(await readFile(join(root, `${report.artifactId}.bin`))).toHaveLength(report.size);
  });

  it('adds only explicitly requested selector-free element PNG captures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-element-report-'));
    const artifacts = createVisualArtifactStore(root, { ttlMs: 60_000 });
    const png = await artifacts.put(new Uint8Array([1, 2, 3]), 'image/png');
    const report = await createVisualReport({
      process: {}, snapshot: {}, surface: {}, lifecycle: [], diagnostics: [], timeline: [], semanticElements: {},
      captureElement: async (elementKey) => ({ result: { element: { key: elementKey } }, png }),
      artifacts,
      now: () => new Date('2026-09-02T00:00:01.000Z'),
    }, {
      windowId: 4, surfaceId: 'surface-a', beforeMs: 10_000, elementKeys: ['canvas.root'],
      include: {
        surfaceCapture: false, elementCaptures: true, semanticElements: false,
        recentLifecycle: false, recentDiagnostics: false, timeline: false,
      },
    });
    const bytes = (await artifacts.read(report.artifactId, 0, 1024 * 1024)).bytes;
    const entries = storedZipEntries(bytes);
    expect([...entries.keys()]).toEqual(expect.arrayContaining([
      'manifest.json', 'process.json', 'snapshot.json', 'surface.json',
      'elements/canvas.root.json', 'elements/canvas.root.png',
    ]));
    expect(entries.get('elements/canvas.root.png')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('cleans captured inputs when final report storage is interrupted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-report-interrupted-'));
    let putCount = 0;
    let interruptedReportId: string | undefined;
    const baseArtifacts = createVisualArtifactStore(root, {
      ttlMs: 60_000,
      onAfterMetadataInsert: (metadata) => {
        putCount += 1;
        if (putCount === 3) {
          interruptedReportId = metadata.artifactId;
          throw new Error('report write interrupted after publication began');
        }
      },
    });
    const firstPng = await baseArtifacts.put(new Uint8Array([1, 2, 3]), 'image/png');
    const secondPng = await baseArtifacts.put(new Uint8Array([4, 5, 6]), 'image/png');

    await expect(createVisualReport({
      process: {}, snapshot: {}, surface: {}, lifecycle: [], diagnostics: [], timeline: [], semanticElements: {},
      captureElement: async (elementKey) => ({
        result: { element: { key: elementKey } },
        png: elementKey === 'canvas.root' ? firstPng : secondPng,
      }),
      artifacts: baseArtifacts,
    }, {
      windowId: 4, surfaceId: 'surface-a', beforeMs: 10_000,
      elementKeys: ['canvas.root', 'sidebar'],
      include: {
        surfaceCapture: false, elementCaptures: true, semanticElements: false,
        recentLifecycle: false, recentDiagnostics: false, timeline: false,
      },
    })).rejects.toThrow('report write interrupted after publication began');

    expect(interruptedReportId).toBeDefined();
    await expect(baseArtifacts.read(interruptedReportId!, 0, 1024)).rejects.toThrow('artifact is unavailable');
    await expect(baseArtifacts.read(firstPng.artifactId, 0, 1024)).rejects.toThrow('artifact is unavailable');
    await expect(baseArtifacts.read(secondPng.artifactId, 0, 1024)).rejects.toThrow('artifact is unavailable');
    expect((await readdir(root)).filter((name) => name.endsWith('.bin') || name.endsWith('.tmp'))).toEqual([]);
  });

  it('revokes a report ZIP that finishes publication concurrently with cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-report-cancelled-'));
    const controller = new AbortController();
    let putCount = 0;
    let reportId: string | undefined;
    const artifacts = createVisualArtifactStore(root, {
      ttlMs: 60_000,
      onAfterMetadataInsert: (metadata) => {
        putCount += 1;
        if (putCount === 2) {
          reportId = metadata.artifactId;
          controller.abort();
        }
      },
    });
    const source = await artifacts.put(new Uint8Array([9, 8, 7]), 'image/png');

    await expect(createVisualReport({
      process: {}, snapshot: {}, surface: {}, lifecycle: [], diagnostics: [], timeline: [], semanticElements: {},
      captureSurface: async () => ({ result: { captureId: 'surface-a' }, png: source }),
      artifacts,
      signal: controller.signal,
    }, {
      windowId: 4, surfaceId: 'surface-a', beforeMs: 10_000, elementKeys: [],
      include: {
        surfaceCapture: true, elementCaptures: false, semanticElements: false,
        recentLifecycle: false, recentDiagnostics: false, timeline: false,
      },
    })).rejects.toThrow('Visual operation was cancelled.');

    expect(reportId).toBeDefined();
    await vi.waitFor(async () => {
      expect((await readdir(root)).filter((name) => name.endsWith('.bin') || name.endsWith('.tmp'))).toEqual([]);
    });
    await expect(artifacts.read(reportId!, 0, 1024)).rejects.toThrow('artifact is unavailable');
    await expect(artifacts.read(source.artifactId, 0, 1024)).rejects.toThrow('artifact is unavailable');
    expect((await readdir(root)).filter((name) => name.endsWith('.bin') || name.endsWith('.tmp'))).toEqual([]);
  });

  it('settles cancellation while a serialized source-artifact read is held', async () => {
    const controller = new AbortController();
    let releaseRead!: (chunk: { metadata: VisualArtifactMetadata; offset: number; nextOffset: number; done: boolean; bytes: Uint8Array }) => void;
    const heldRead = new Promise<{ metadata: VisualArtifactMetadata; offset: number; nextOffset: number; done: boolean; bytes: Uint8Array }>((resolve) => { releaseRead = resolve; });
    const source: VisualArtifactMetadata = {
      artifactId: 'va-11111111-1111-4111-8111-111111111111',
      mimeType: 'image/png', size: 1, sha256: createHash('sha256').update(new Uint8Array([1])).digest('hex'),
      createdAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z',
    };
    const artifacts = {
      put: vi.fn(),
      read: vi.fn(async () => heldRead),
      delete: vi.fn(async () => true),
      cleanup: vi.fn(async () => undefined),
    };
    const report = createVisualReport({
      process: {}, snapshot: {}, surface: {}, lifecycle: [], diagnostics: [], timeline: [], semanticElements: {},
      captureSurface: async () => ({ result: {}, png: source }),
      artifacts,
      signal: controller.signal,
    }, {
      windowId: 4, surfaceId: 'surface-a', beforeMs: 10_000, elementKeys: [],
      include: {
        surfaceCapture: true, elementCaptures: false, semanticElements: false,
        recentLifecycle: false, recentDiagnostics: false, timeline: false,
      },
    });

    await vi.waitFor(() => expect(artifacts.read).toHaveBeenCalledOnce());
    controller.abort();
    await expect(report).rejects.toThrow('Visual operation was cancelled.');
    releaseRead({ metadata: source, offset: 0, nextOffset: 1, done: true, bytes: new Uint8Array([1]) });
    expect(artifacts.put).not.toHaveBeenCalled();
    expect(artifacts.delete).toHaveBeenCalledWith(source.artifactId);
  });
});
