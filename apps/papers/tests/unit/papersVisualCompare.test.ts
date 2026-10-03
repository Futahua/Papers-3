import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the standalone comparison tool is intentionally plain ESM shipped with tools.
import { compareEvidence, hashSemanticSnapshot } from '../../tools/papersVisualCompare.mjs';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type); const result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length, 0); typeBytes.copy(result, 4); Buffer.from(data).copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length); return result;
}

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) { rows[y * (width * 4 + 1)] = 0; Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function zip(entries: Array<{ name: string; bytes: Buffer }>): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) { const name = Buffer.from(entry.name); const local = Buffer.alloc(30 + name.length + entry.bytes.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(entry.bytes.length, 18); local.writeUInt32LE(entry.bytes.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30); entry.bytes.copy(local, 30 + name.length); locals.push(local); const c = Buffer.alloc(46 + name.length); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt32LE(entry.bytes.length, 20); c.writeUInt32LE(entry.bytes.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42); name.copy(c, 46); central.push(c); offset += local.length; }
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, centralBytes, end]);
}

const semantic = { windowId: 1, surfaceId: 'surface-a', elements: [{ key: 'canvas.root', boundsCss: { x: 0, y: 0, width: 1, height: 1 } }] };

async function evidence(root: string, image: Buffer, semanticValue = semantic) {
  const elements = Buffer.from(`${JSON.stringify(semanticValue)}\n`); const manifestEntries = [
    { name: 'elements.json', size: elements.length, sha256: createHash('sha256').update(elements).digest('hex') },
    { name: 'surface.png', size: image.length, sha256: createHash('sha256').update(image).digest('hex') },
  ];
  const archive = zip([{ name: 'manifest.json', bytes: Buffer.from(`${JSON.stringify({ schemaVersion: 1, entries: manifestEntries })}\n`) }, { name: 'elements.json', bytes: elements }, { name: 'surface.png', bytes: image }]);
  await writeFile(join(root, 'report.zip'), archive); await writeFile(join(root, 'summary.json'), JSON.stringify({ report: { size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') } }));
}

describe('read-only visual baseline comparison', () => {
  it('decodes RGBA captures and reports identical, pixel, dimension, and semantic changes independently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-compare-')); const expected = png(2, 1, new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]));
    const manifest = { schemaVersion: 1, pngSha256: createHash('sha256').update(expected).digest('hex'), dimensions: { width: 2, height: 1 }, semanticSnapshotSha256: hashSemanticSnapshot(semantic) };
    await writeFile(join(root, 'baseline.json'), JSON.stringify(manifest)); await writeFile(join(root, 'baseline.png'), expected); await evidence(root, expected);
    expect((await compareEvidence({ baselineManifestPath: join(root, 'baseline.json'), baselinePngPath: join(root, 'baseline.png'), evidenceDir: root })).comparison).toMatchObject({ dimensionsMatch: true, changedPixelCount: 0, semanticChanged: false });
    const mutated = png(2, 1, new Uint8Array([3, 0, 0, 255, 255, 255, 255, 255])); await evidence(root, mutated, { ...semantic, elements: [] });
    expect((await compareEvidence({ baselineManifestPath: join(root, 'baseline.json'), baselinePngPath: join(root, 'baseline.png'), evidenceDir: root })).comparison).toMatchObject({ dimensionsMatch: true, changedPixelCount: 1, semanticChanged: true });
    await evidence(root, png(1, 1, new Uint8Array([0, 0, 0, 255])));
    expect((await compareEvidence({ baselineManifestPath: join(root, 'baseline.json'), baselinePngPath: join(root, 'baseline.png'), evidenceDir: root })).comparison).toMatchObject({ dimensionsMatch: false, changedPixelCount: null, semanticChanged: false });
  });

  it('rejects a baseline whose explicit source hash no longer matches its manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-compare-integrity-')); const image = png(1, 1, new Uint8Array([0, 0, 0, 255]));
    await writeFile(join(root, 'baseline.json'), JSON.stringify({ schemaVersion: 1, pngSha256: '0'.repeat(64), dimensions: { width: 1, height: 1 }, semanticSnapshotSha256: hashSemanticSnapshot(semantic) })); await writeFile(join(root, 'baseline.png'), image); await evidence(root, image);
    await expect(compareEvidence({ baselineManifestPath: join(root, 'baseline.json'), baselinePngPath: join(root, 'baseline.png'), evidenceDir: root })).rejects.toThrow('baseline PNG hash mismatch');
  });

  it('requires the evidence ZIP to match the runner-recorded summary identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-visual-compare-summary-')); const image = png(1, 1, new Uint8Array([0, 0, 0, 255]));
    await writeFile(join(root, 'baseline.json'), JSON.stringify({ schemaVersion: 1, pngSha256: createHash('sha256').update(image).digest('hex'), dimensions: { width: 1, height: 1 }, semanticSnapshotSha256: hashSemanticSnapshot(semantic) })); await writeFile(join(root, 'baseline.png'), image); await evidence(root, image); await writeFile(join(root, 'summary.json'), JSON.stringify({ report: { size: 1, sha256: '0'.repeat(64) } }));
    await expect(compareEvidence({ baselineManifestPath: join(root, 'baseline.json'), baselinePngPath: join(root, 'baseline.png'), evidenceDir: root })).rejects.toThrow('does not match the P1 summary identity');
  });
});
