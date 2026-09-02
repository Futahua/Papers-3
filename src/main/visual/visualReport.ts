import { createHash, randomUUID } from 'node:crypto';

import type { VisualDiagnosticRecord } from './visualDiagnostics';
import type { VisualArtifactMetadata, VisualArtifactStore } from './visualArtifactStore';
import type { VisualTimelineEntry } from './visualTimeline';

export interface VisualReportRequest {
  windowId: number;
  surfaceId: string;
  beforeMs: number;
  elementKeys: string[];
  include: {
    surfaceCapture: boolean;
    elementCaptures: boolean;
    semanticElements: boolean;
    recentLifecycle: boolean;
    recentDiagnostics: boolean;
    timeline: boolean;
  };
}

export interface VisualReportDependencies {
  process: unknown;
  snapshot: unknown;
  surface: unknown;
  lifecycle: VisualDiagnosticRecord[];
  diagnostics: VisualDiagnosticRecord[];
  timeline: VisualTimelineEntry[];
  semanticElements: unknown;
  captureSurface?: (signal?: AbortSignal) => Promise<{ result: unknown; png?: VisualArtifactMetadata }>;
  captureElement?: (elementKey: string, signal?: AbortSignal) => Promise<{ result: unknown; png?: VisualArtifactMetadata }>;
  artifacts: VisualArtifactStore;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface VisualReportResult {
  reportId: string;
  artifactId: string;
  size: number;
  sha256: string;
  createdAt: string;
  manifestSummary: {
    entryCount: number;
    byteSize: number;
    includes: VisualReportRequest['include'];
  };
}

interface ReportEntry {
  name: string;
  bytes: Uint8Array;
}

const MAX_REPORT_ENTRIES = 32;
const MAX_ELEMENT_CAPTURES = 8;

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function ndjsonBytes(records: unknown[]): Uint8Array {
  return new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : ''));
}

async function readArtifact(store: VisualArtifactStore, metadata: VisualArtifactMetadata, signal?: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let done = false;
  while (!done) {
    if (signal?.aborted) throw new Error('Visual report was cancelled.');
    const chunk = await store.read(metadata.artifactId, offset, 1024 * 1024);
    chunks.push(chunk.bytes);
    offset = chunk.nextOffset;
    done = chunk.done;
  }
  if (signal?.aborted) throw new Error('Visual report was cancelled.');
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  if (bytes.byteLength !== metadata.size || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
    throw new Error('source visual artifact integrity check failed');
  }
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries: ReportEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const write16 = (view: DataView, position: number, value: number): void => view.setUint16(position, value, true);
  const write32 = (view: DataView, position: number, value: number): void => view.setUint32(position, value >>> 0, true);
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20); write16(localView, 6, 0x800); write16(localView, 8, 0);
    write16(localView, 10, 0); write16(localView, 12, 0);
    write32(localView, 14, checksum); write32(localView, 18, entry.bytes.byteLength); write32(localView, 22, entry.bytes.byteLength);
    write16(localView, 26, name.byteLength); write16(localView, 28, 0);
    local.set(name, 30); local.set(entry.bytes, 30 + name.byteLength);
    localParts.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20);
    write16(centralView, 8, 0x800); write16(centralView, 10, 0); write16(centralView, 12, 0); write16(centralView, 14, 0);
    write32(centralView, 16, checksum); write32(centralView, 20, entry.bytes.byteLength); write32(centralView, 24, entry.bytes.byteLength);
    write16(centralView, 28, name.byteLength); write16(centralView, 30, 0); write16(centralView, 32, 0);
    write16(centralView, 34, 0); write16(centralView, 36, 0); write32(centralView, 38, 0); write32(centralView, 42, offset);
    central.set(name, 46); centralParts.push(central);
    offset += local.byteLength;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0); write16(endView, 8, entries.length); write16(endView, 10, entries.length);
  write32(endView, 12, centralSize); write32(endView, 16, centralOffset); write16(endView, 20, 0);
  const result = new Uint8Array(offset + centralSize + end.byteLength);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) { result.set(part, cursor); cursor += part.byteLength; }
  return result;
}

export async function createVisualReport(deps: VisualReportDependencies, request: VisualReportRequest): Promise<VisualReportResult> {
  const now = deps.now ?? (() => new Date());
  const createdAtDate = now();
  const createdAt = createdAtDate.toISOString();
  const cutoff = createdAtDate.getTime() - request.beforeMs;
  const inWindow = (record: VisualDiagnosticRecord): boolean => Date.parse(record.observedAt) >= cutoff;
  const lifecycle = deps.lifecycle.filter(inWindow);
  const diagnostics = deps.diagnostics.filter(inWindow);
  const reportId = randomUUID();
  const signal = deps.signal;
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new Error('Visual report was cancelled.');
  };
  const capturedArtifactIds = new Set<string>();
  let reportArtifactId: string | undefined;
  const readCapturedArtifact = async (metadata: VisualArtifactMetadata): Promise<Uint8Array> => {
    // Capture artifacts are temporary inputs owned by this report operation.
    // Keep their IDs so an interrupted build cannot leave unreferenced PNGs.
    capturedArtifactIds.add(metadata.artifactId);
    return readArtifact(deps.artifacts, metadata, signal);
  };
  try {
    throwIfAborted();
    const entries: ReportEntry[] = [
      { name: 'process.json', bytes: jsonBytes(deps.process) },
      { name: 'snapshot.json', bytes: jsonBytes(deps.snapshot) },
      { name: 'surface.json', bytes: jsonBytes(deps.surface) },
    ];
    if (request.include.recentLifecycle) entries.push({ name: 'lifecycle.ndjson', bytes: ndjsonBytes(lifecycle) });
    if (request.include.recentDiagnostics) entries.push({ name: 'diagnostics.ndjson', bytes: ndjsonBytes(diagnostics) });
    if (request.include.timeline) entries.push({ name: 'timeline.ndjson', bytes: ndjsonBytes(deps.timeline) });
    if (request.include.semanticElements) entries.push({ name: 'elements.json', bytes: jsonBytes(deps.semanticElements) });
    if (request.include.surfaceCapture) {
      if (!deps.captureSurface) throw new Error('Visual surface capture is unavailable.');
      const captured = await deps.captureSurface(signal);
      throwIfAborted();
      entries.push({ name: 'surface-capture.json', bytes: jsonBytes(captured.result) });
      if (captured.png) entries.push({ name: 'surface.png', bytes: await readCapturedArtifact(captured.png) });
    }
    if (request.include.elementCaptures) {
      if (!deps.captureElement) throw new Error('Visual element capture is unavailable.');
      if (request.elementKeys.length < 1 || request.elementKeys.length > MAX_ELEMENT_CAPTURES) {
        throw new Error('visual element report capture count is invalid');
      }
      for (const elementKey of request.elementKeys) {
        const captured = await deps.captureElement(elementKey, signal);
        throwIfAborted();
        entries.push({ name: `elements/${elementKey}.json`, bytes: jsonBytes(captured.result) });
        if (captured.png) entries.push({ name: `elements/${elementKey}.png`, bytes: await readCapturedArtifact(captured.png) });
      }
    }
    if (entries.length > MAX_REPORT_ENTRIES) throw new Error('visual report entry bound exceeded');
    const manifestEntries = entries.map((entry) => ({ name: entry.name, size: entry.bytes.byteLength, sha256: createHash('sha256').update(entry.bytes).digest('hex') }));
    const manifest = {
      schemaVersion: 1,
      reportId,
      createdAt,
      target: { windowId: request.windowId, surfaceId: request.surfaceId },
      beforeMs: request.beforeMs,
      entries: manifestEntries,
      summary: { entryCount: manifestEntries.length + 1, includes: request.include },
    };
    const allEntries = [{ name: 'manifest.json', bytes: jsonBytes(manifest) }, ...entries];
    const archive = zipStored(allEntries);
    throwIfAborted();
    const artifact = await deps.artifacts.put(archive, 'application/zip');
    throwIfAborted();
    reportArtifactId = artifact.artifactId;
    return {
      reportId,
      artifactId: artifact.artifactId,
      size: artifact.size,
      sha256: artifact.sha256,
      createdAt,
      manifestSummary: { entryCount: allEntries.length, byteSize: archive.byteLength, includes: request.include },
    };
  } finally {
    await Promise.all([...capturedArtifactIds]
      .filter((artifactId) => artifactId !== reportArtifactId)
      .map((artifactId) => deps.artifacts.delete(artifactId).catch(() => false)));
  }
}
