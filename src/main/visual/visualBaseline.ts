import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

const baselineKeySchema = z.object({
  fixtureId: z.string().min(1).max(128),
  captureTarget: z.string().min(1).max(128),
  visualProfileVersion: z.number().int().positive(),
  platform: z.string().min(1).max(64),
  electronVersion: z.string().min(1).max(64),
}).strict();

const baselineManifestSchema = z.object({
  schemaVersion: z.literal(1),
  baselineId: z.string().regex(/^vb-[0-9a-f]{24}$/),
  key: baselineKeySchema,
  pngSha256: z.string().regex(/^[0-9a-f]{64}$/),
  dimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  semanticSnapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdFromCommit: z.string().min(1).max(128),
  createdAt: z.string().datetime(),
}).strict();

export type VisualBaselineKey = z.infer<typeof baselineKeySchema>;
export type VisualBaselineManifest = z.infer<typeof baselineManifestSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export function hashSemanticSnapshot(snapshot: unknown): string {
  return hashBytes(Buffer.from(canonicalJson(snapshot), 'utf8'));
}

function baselineId(key: VisualBaselineKey): string {
  return `vb-${hashBytes(Buffer.from(canonicalJson(key), 'utf8')).slice(0, 24)}`;
}

export interface VisualRaster {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface VisualImageComparison {
  dimensionsMatch: boolean;
  expectedDimensions: { width: number; height: number };
  actualDimensions: { width: number; height: number };
  changedPixelCount: number;
  changedPixelPercent: number | null;
  maxBoundingDiffRect: { x: number; y: number; width: number; height: number } | null;
  perceptualScore: number | null;
  semanticChanged: boolean;
}

function assertRaster(raster: VisualRaster, label: string): void {
  if (!Number.isSafeInteger(raster.width) || !Number.isSafeInteger(raster.height) || raster.width < 1 || raster.height < 1
    || raster.rgba.byteLength !== raster.width * raster.height * 4) throw new Error(`${label} raster shape is invalid`);
}

export function compareVisualImages(
  expected: VisualRaster,
  actual: VisualRaster,
  expectedSemanticSha256: string,
  actualSemanticSha256: string,
): VisualImageComparison {
  assertRaster(expected, 'expected'); assertRaster(actual, 'actual');
  const dimensionsMatch = expected.width === actual.width && expected.height === actual.height;
  const totalPixels = Math.max(1, expected.width * expected.height);
  if (!dimensionsMatch) {
    return { dimensionsMatch, expectedDimensions: { width: expected.width, height: expected.height }, actualDimensions: { width: actual.width, height: actual.height },
      changedPixelCount: 0, changedPixelPercent: null, maxBoundingDiffRect: null, perceptualScore: null, semanticChanged: expectedSemanticSha256 !== actualSemanticSha256 };
  }
  let changedPixelCount = 0;
  let totalDelta = 0;
  let minX = expected.width; let minY = expected.height; let maxX = -1; let maxY = -1;
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4;
    const delta = Math.abs(expected.rgba[offset]! - actual.rgba[offset]!)
      + Math.abs(expected.rgba[offset + 1]! - actual.rgba[offset + 1]!)
      + Math.abs(expected.rgba[offset + 2]! - actual.rgba[offset + 2]!)
      + Math.abs(expected.rgba[offset + 3]! - actual.rgba[offset + 3]!);
    totalDelta += delta;
    if (delta === 0) continue;
    changedPixelCount += 1;
    const x = pixel % expected.width; const y = Math.floor(pixel / expected.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return {
    dimensionsMatch,
    expectedDimensions: { width: expected.width, height: expected.height },
    actualDimensions: { width: actual.width, height: actual.height },
    changedPixelCount,
    changedPixelPercent: Math.round((changedPixelCount / totalPixels) * 1_000_000) / 10_000,
    maxBoundingDiffRect: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    perceptualScore: Math.max(0, Math.min(1, Math.round((1 - totalDelta / (totalPixels * 4 * 255)) * 1_000_000) / 1_000_000)),
    semanticChanged: expectedSemanticSha256 !== actualSemanticSha256,
  };
}

export interface VisualBaselineStore {
  read(key: VisualBaselineKey): Promise<{ manifest: VisualBaselineManifest; png: Uint8Array } | null>;
  update(input: {
    key: VisualBaselineKey;
    png: Uint8Array;
    width: number;
    height: number;
    semanticSnapshot: unknown;
    createdFromCommit: string;
    allowUpdate: boolean;
  }): Promise<{ previous: VisualBaselineManifest | null; current: VisualBaselineManifest }>;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 24 || !signature.every((value, index) => bytes[index] === value)) throw new Error('baseline bytes are not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('baseline PNG header is invalid');
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error('baseline PNG dimensions are invalid');
  return { width, height };
}

export function createVisualBaselineStore(rootDir: string, options: { now?: () => Date; publishManifest?: (temporary: string, finalPath: string) => Promise<void> } = {}): VisualBaselineStore {
  const now = options.now ?? (() => new Date());
  const manifestPath = (id: string) => path.join(rootDir, `${id}.manifest.json`);
  const pngPath = (id: string, sha256: string) => path.join(rootDir, `${id}-${sha256}.png`);
  let updateQueue: Promise<void> = Promise.resolve();
  const read = async (input: VisualBaselineKey) => {
    const key = baselineKeySchema.parse(input);
    const id = baselineId(key);
    let manifest: VisualBaselineManifest;
    try { manifest = baselineManifestSchema.parse(JSON.parse(await readFile(manifestPath(id), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (canonicalJson(manifest.key) !== canonicalJson(key)) throw new Error('baseline manifest key mismatch');
    const png = new Uint8Array(await readFile(pngPath(id, manifest.pngSha256)));
    if (hashBytes(png) !== manifest.pngSha256) throw new Error('baseline PNG hash mismatch');
    if (JSON.stringify(pngDimensions(png)) !== JSON.stringify(manifest.dimensions)) throw new Error('baseline PNG dimensions mismatch');
    return { manifest, png };
  };
  return {
    read,
    update(input) {
      const previousUpdate = updateQueue;
      let release!: () => void;
      updateQueue = new Promise<void>((resolve) => { release = resolve; });
      return (async () => {
       await previousUpdate;
       try {
      if (input.allowUpdate !== true) throw new Error('visual baseline update requires explicit opt-in');
      const key = baselineKeySchema.parse(input.key);
      if (!(input.png instanceof Uint8Array) || input.png.byteLength < 1 || input.png.byteLength > 16 * 1024 * 1024) throw new Error('baseline PNG is outside the allowed bound');
      const actualDimensions = pngDimensions(input.png);
      if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 16384 || input.height > 16384
        || input.width !== actualDimensions.width || input.height !== actualDimensions.height) throw new Error('baseline dimensions do not match PNG');
      const previous = await read(key);
      const id = baselineId(key);
      const pngSha256 = hashBytes(input.png);
      const current = baselineManifestSchema.parse({ schemaVersion: 1, baselineId: id, key, pngSha256,
        dimensions: { width: input.width, height: input.height }, semanticSnapshotSha256: hashSemanticSnapshot(input.semanticSnapshot),
        createdFromCommit: input.createdFromCommit, createdAt: now().toISOString() });
      await mkdir(rootDir, { recursive: true });
      const finalPng = pngPath(id, pngSha256); const tempPng = `${finalPng}.${randomUUID()}.tmp`;
      try { await writeFile(tempPng, input.png, { flag: 'wx' }); await rename(tempPng, finalPng); }
      catch (error) {
        await rm(tempPng, { force: true });
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = new Uint8Array(await readFile(finalPng));
        if (hashBytes(existing) !== pngSha256 || JSON.stringify(pngDimensions(existing)) !== JSON.stringify(actualDimensions)) throw new Error('existing baseline PNG integrity mismatch');
      }
      const finalManifest = manifestPath(id); const tempManifest = `${finalManifest}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempManifest, JSON.stringify(current), { encoding: 'utf8', flag: 'wx' });
        if (options.publishManifest) await options.publishManifest(tempManifest, finalManifest);
        else await rename(tempManifest, finalManifest);
      } catch (error) { await rm(tempManifest, { force: true }); throw error; }
      return { previous: previous?.manifest ?? null, current };
       } finally {
         release();
       }
      })();
    },
  };
}
