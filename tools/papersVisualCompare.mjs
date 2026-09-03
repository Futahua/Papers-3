#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readDescriptor } from './papersControlClient.mjs';
import { runVisualDebug, verifyReportArchive } from './papersVisualDebug.mjs';

const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_DIMENSION = 16384;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function hashSemanticSnapshot(snapshot) { return sha256(Buffer.from(canonicalJson(snapshot), 'utf8')); }

function paeth(a, b, c) {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode the bounded 8-bit, non-interlaced PNGs emitted by Electron captures. */
export function decodePngRgba(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 33 || bytes.byteLength > MAX_PNG_BYTES) throw new Error('PNG is outside the allowed bound');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('PNG signature is invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; let width; let height; let bitDepth; let colorType; let interlace; let idat = []; let palette; let transparency;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset); const end = offset + 12 + length;
    if (end > bytes.byteLength) throw new Error('PNG chunk is truncated');
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)); const data = bytes.slice(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('PNG IHDR is invalid');
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    if (type === 'IEND') break;
    offset = end;
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION
    || bitDepth !== 8 || interlace !== 0 || ![2, 3, 4, 6].includes(colorType) || idat.length === 0) throw new Error('PNG format is unsupported');
  const channels = ({ 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  const rowBytes = width * channels; const inflated = new Uint8Array(inflateSync(Buffer.concat(idat)));
  if (inflated.byteLength !== height * (rowBytes + 1)) throw new Error('PNG scanline data is invalid');
  const raw = new Uint8Array(height * rowBytes); const prior = new Uint8Array(rowBytes); let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source++]; const row = inflated.slice(source, source + rowBytes); source += rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels] : 0; const up = prior[x] ?? 0; const upperLeft = x >= channels ? prior[x - channels] ?? 0 : 0;
      row[x] = (row[x] + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : filter === 0 ? 0 : (() => { throw new Error('PNG filter is invalid'); })())) & 255;
    }
    raw.set(row, y * rowBytes); prior.set(row);
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * channels; const target = pixel * 4;
    if (colorType === 6) rgba.set(raw.slice(sourceOffset, sourceOffset + 4), target);
    else if (colorType === 4) { rgba[target] = raw[sourceOffset]; rgba[target + 1] = raw[sourceOffset]; rgba[target + 2] = raw[sourceOffset]; rgba[target + 3] = raw[sourceOffset + 1]; }
    else if (colorType === 2) { rgba[target] = raw[sourceOffset]; rgba[target + 1] = raw[sourceOffset + 1]; rgba[target + 2] = raw[sourceOffset + 2]; rgba[target + 3] = 255; }
    else {
      const index = raw[sourceOffset]; const paletteOffset = index * 3;
      if (!palette || paletteOffset + 2 >= palette.length) throw new Error('PNG palette is invalid');
      rgba[target] = palette[paletteOffset]; rgba[target + 1] = palette[paletteOffset + 1]; rgba[target + 2] = palette[paletteOffset + 2]; rgba[target + 3] = transparency?.[index] ?? 255;
    }
  }
  return { width, height, rgba };
}

export function compareRasters(expected, actual, expectedSemanticSha256, actualSemanticSha256) {
  const dimensionsMatch = expected.width === actual.width && expected.height === actual.height;
  if (!dimensionsMatch) return { dimensionsMatch, expectedDimensions: { width: expected.width, height: expected.height }, actualDimensions: { width: actual.width, height: actual.height }, changedPixelCount: null, changedPixelPercent: null, maxBoundingDiffRect: null, perceptualScore: null, semanticChanged: expectedSemanticSha256 !== actualSemanticSha256 };
  const totalPixels = expected.width * expected.height; let changedPixelCount = 0; let totalDelta = 0; let minX = expected.width; let minY = expected.height; let maxX = -1; let maxY = -1;
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const source = pixel * 4; const delta = Math.abs(expected.rgba[source] - actual.rgba[source]) + Math.abs(expected.rgba[source + 1] - actual.rgba[source + 1]) + Math.abs(expected.rgba[source + 2] - actual.rgba[source + 2]) + Math.abs(expected.rgba[source + 3] - actual.rgba[source + 3]);
    totalDelta += delta; if (!delta) continue; changedPixelCount += 1; const x = pixel % expected.width; const y = Math.floor(pixel / expected.width); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { dimensionsMatch, expectedDimensions: { width: expected.width, height: expected.height }, actualDimensions: { width: actual.width, height: actual.height }, changedPixelCount, changedPixelPercent: Math.round(changedPixelCount / totalPixels * 1_000_000) / 10_000, maxBoundingDiffRect: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, perceptualScore: Math.max(0, Math.min(1, Math.round((1 - totalDelta / (totalPixels * 4 * 255)) * 1_000_000) / 1_000_000)), semanticChanged: expectedSemanticSha256 !== actualSemanticSha256 };
}

async function readBaseline(manifestPath, pngPath) {
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  if (manifest?.schemaVersion !== 1 || typeof manifest.pngSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.pngSha256) || !manifest.dimensions || typeof manifest.semanticSnapshotSha256 !== 'string') throw new Error('baseline manifest is invalid');
  const png = new Uint8Array(await readFile(resolve(pngPath))); if (sha256(png) !== manifest.pngSha256) throw new Error('baseline PNG hash mismatch');
  const raster = decodePngRgba(png); if (raster.width !== manifest.dimensions.width || raster.height !== manifest.dimensions.height) throw new Error('baseline PNG dimensions mismatch');
  return { manifest, raster };
}

export async function compareEvidence({ baselineManifestPath, baselinePngPath, evidenceDir }) {
  const baseline = await readBaseline(baselineManifestPath, baselinePngPath);
  const reportBytes = await readFile(join(resolve(evidenceDir), 'report.zip')); const report = { size: reportBytes.byteLength, sha256: sha256(reportBytes) };
  const { entries } = verifyReportArchive(reportBytes, report); const actualPng = entries.get('surface.png'); if (!actualPng) throw new Error('live report surface PNG is missing');
  const actualSemanticBytes = entries.get('elements.json'); if (!actualSemanticBytes) throw new Error('live report semantic elements are missing');
  const actualSemantic = JSON.parse(Buffer.from(actualSemanticBytes).toString('utf8')); const actual = decodePngRgba(actualPng);
  return { schemaVersion: 1, baseline: { manifest: baseline.manifest, pngSha256Verified: true }, actual: { pngSha256: sha256(actualPng), semanticSnapshotSha256: hashSemanticSnapshot(actualSemantic), evidenceDir: resolve(evidenceDir) }, comparison: compareRasters(baseline.raster, actual, baseline.manifest.semanticSnapshotSha256, hashSemanticSnapshot(actualSemantic)) };
}

export async function runVisualCompare(options) {
  if (!options.baselineManifestPath || !options.baselinePngPath) throw new Error('--baseline-manifest and --baseline-png are required');
  let evidenceDir = options.evidenceDir ? resolve(options.evidenceDir) : await mkdtemp(join(tmpdir(), 'papers-visual-compare-'));
  if (!options.evidenceDir) await mkdir(evidenceDir, { recursive: true });
  if (options.evidenceDir) return compareEvidence({ ...options, evidenceDir });
  if (!options.descriptorPath) throw new Error('--descriptor is required for live comparison');
  try { await readDescriptor(options.descriptorPath); } catch { throw new Error('diagnostic mode unavailable: an existing control descriptor is required'); }
  await runVisualDebug({ descriptorPath: options.descriptorPath, windowId: options.windowId, surfaceId: options.surfaceId, timeoutMs: options.timeoutMs, outputDir: evidenceDir });
  return compareEvidence({ ...options, evidenceDir });
}

function argValue(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function parseArgs(args) {
  if (args.includes('--update') || args.includes('--bless')) throw new Error('baseline update/blessing is not part of read-only comparison');
  return { descriptorPath: argValue(args, '--descriptor'), windowId: Number(argValue(args, '--window')), surfaceId: argValue(args, '--surface'), timeoutMs: Number(argValue(args, '--timeout-ms') ?? 5000), baselineManifestPath: argValue(args, '--baseline-manifest'), baselinePngPath: argValue(args, '--baseline-png'), evidenceDir: argValue(args, '--evidence-dir') };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) runVisualCompare(parseArgs(process.argv.slice(2))).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
