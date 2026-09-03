#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

const MAX_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_EVENT_RECORDS = 512;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireTarget(windowId, surfaceId) {
  if (!Number.isInteger(windowId) || windowId < 1 || typeof surfaceId !== 'string' || surfaceId.length < 1 || surfaceId.length > 128) {
    throw new Error('an explicit --window integer and --surface id are required');
  }
  return { windowId, surfaceId };
}

function assertMetadata(metadata) {
  if (!metadata || typeof metadata.artifactId !== 'string' || !Number.isInteger(metadata.size) || metadata.size < 1
    || typeof metadata.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.sha256)) {
    throw new Error('control returned invalid visual artifact metadata');
  }
}

export async function readArtifact(connection, metadata) {
  assertMetadata(metadata);
  if (metadata.size > MAX_OUTPUT_BYTES) throw new Error('visual artifact exceeds the runner bound');
  const chunks = [];
  let offset = 0;
  while (true) {
    const response = await connection.call('visual.artifact.read', { artifactId: metadata.artifactId, offset, length: 1024 * 1024 });
    if (!response?.ok) throw new Error(response?.error ?? 'visual artifact read failed');
    const chunk = response.result;
    const bytes = Buffer.from(chunk.bytesBase64, 'base64');
    if (chunk.offset !== offset || chunk.nextOffset !== offset + bytes.length || chunk.nextOffset > metadata.size
      || (!chunk.done && chunk.nextOffset <= offset) || (chunk.done && chunk.nextOffset !== metadata.size)) {
      throw new Error('visual artifact chunk sequence is invalid');
    }
    chunks.push(bytes);
    offset = chunk.nextOffset;
    if (chunk.done) break;
  }
  const result = Buffer.concat(chunks);
  if (result.length !== metadata.size || sha256(result) !== metadata.sha256) throw new Error('visual artifact integrity check failed');
  return result;
}

export function parseStoredZip(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('visual report is not a stored ZIP archive');
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const size = bytes.readUInt32LE(offset + 22);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const end = dataStart + size;
    if (end > bytes.length) throw new Error('visual report ZIP entry is truncated');
    const name = bytes.subarray(nameStart, dataStart - extraLength).toString('utf8');
    if (!name || name.includes('..') || name.startsWith('/')) throw new Error('visual report entry name is unsafe');
    entries.set(name, bytes.subarray(dataStart, end));
    offset = end;
  }
  if (!entries.has('manifest.json')) throw new Error('visual report manifest is missing');
  return entries;
}

export function verifyReportArchive(bytes, report) {
  if (bytes.length !== report.size || sha256(bytes) !== report.sha256) throw new Error('visual report integrity check failed');
  const entries = parseStoredZip(bytes);
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  if (!Array.isArray(manifest.entries)) throw new Error('visual report manifest entries are invalid');
  for (const entry of manifest.entries) {
    const actual = entries.get(entry.name);
    if (!actual || actual.length !== entry.size || sha256(actual) !== entry.sha256) throw new Error(`visual report entry integrity failed: ${entry.name}`);
  }
  if (entries.size !== manifest.entries.length + 1) throw new Error('visual report contains an unmanifested entry');
  return { manifest, entries };
}

function isTerminal(record) {
  return record?.payload?.kind === 'lifecycle' && (record.payload.phase === 'layout-stable' || record.payload.phase === 'render-failed');
}

function isTargetRecord(record, target) {
  return record?.target?.windowId === target.windowId && record?.target?.surfaceId === target.surfaceId;
}

function rawSequenceGaps(records) {
  const sequences = [...new Set(records.map((record) => record.sequence).filter((value) => Number.isInteger(value)))].sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < sequences.length; index += 1) {
    if (sequences[index] > sequences[index - 1] + 1) gaps.push({ from: sequences[index - 1] + 1, to: sequences[index] - 1 });
  }
  return gaps;
}

export function reconcileEventSequences(received, historical, windowDiagnostics = [], target = received[0]?.target) {
  const targetSequences = new Set(historical.map((record) => record.eventSeq ?? record.sequence).filter(Number.isInteger));
  const allRecords = new Map(windowDiagnostics.filter((record) => Number.isInteger(record.sequence)).map((record) => [record.sequence, record]));
  const observed = [...new Set(received.map((record) => record.sequence).filter(Number.isInteger))].sort((a, b) => a - b);
  const recovered = [];
  const crossSurface = [];
  const unresolved = [];
  for (let index = 1; index < observed.length; index += 1) {
    const from = observed[index - 1] + 1;
    const to = observed[index] - 1;
    if (from > to) continue;
    const missing = [];
    for (let sequence = from; sequence <= to; sequence += 1) {
      const historicalRecord = allRecords.get(sequence);
      if (historicalRecord) {
        if (historicalRecord.target?.windowId === target?.windowId && historicalRecord.target?.surfaceId === target?.surfaceId) recovered.push(sequence);
        else crossSurface.push(sequence);
      } else if (targetSequences.has(sequence)) recovered.push(sequence);
      else missing.push(sequence);
    }
    for (const sequence of missing) {
      if (unresolved.at(-1)?.to === sequence - 1) unresolved[unresolved.length - 1].to = sequence;
      else unresolved.push({ from: sequence, to: sequence, reason: 'not-in-current-target-history' });
    }
  }
  return { recoveredSequences: [...new Set(recovered)], crossSurfaceSequences: [...new Set(crossSurface)], unrecoverableGaps: unresolved };
}

export async function waitForVisualTerminal(connection, target, timeoutMs = 5_000) {
  requireTarget(target.windowId, target.surfaceId);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new Error(`--timeout-ms must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  const records = [];
  let eventBytes = 0;
  let transcriptTruncated = false;
  let latestNavigationSequence = 0;
  const appendRecord = (record) => {
    if (!isTargetRecord(record, target)) return;
    if (record.payload?.kind === 'lifecycle' && record.payload.phase === 'navigation-started') latestNavigationSequence = Math.max(latestNavigationSequence, record.sequence);
    records.push(record);
    eventBytes += Buffer.byteLength(JSON.stringify(record));
    while (records.length > MAX_EVENT_RECORDS || eventBytes > MAX_EVENT_BYTES) {
      const removed = records.shift();
      eventBytes -= removed ? Buffer.byteLength(JSON.stringify(removed)) : 0;
      transcriptTruncated = true;
    }
  };
  const eligibleTerminal = () => records.filter((record) => isTerminal(record) && record.sequence > latestNavigationSequence).at(-1);
  let timer;
  let stopEvents = () => {};
  let snapshotPending = true;
  const result = await new Promise((resolve) => {
    const finish = (value) => { clearTimeout(timer); stopEvents(); resolve(value); };
    stopEvents = connection.onEvent((frame) => {
      if (!frame || !['visual.lifecycle', 'visual.diagnostic'].includes(frame.event)) return;
      appendRecord(frame.payload);
      if (!snapshotPending) {
        const terminal = eligibleTerminal();
        if (terminal) finish({ status: 'terminal', terminal, records, rawSequenceGaps: rawSequenceGaps(records), transcriptTruncated, timedOut: false });
      }
    });
    void (async () => {
      try {
        const subscription = await connection.call('events.subscribe', { events: ['visual.lifecycle', 'visual.diagnostic'], visualTarget: target });
        if (!subscription?.ok) { finish({ status: 'error', error: subscription?.error ?? 'visual event subscription failed', records, rawSequenceGaps: rawSequenceGaps(records), timedOut: false }); return; }
        // The event listener and server-side subscription are established before
        // this snapshot, closing the subscribe/read race without polling.
        const initial = await connection.call('inspect.visual.diagnostics', target);
        if (!initial?.ok) { finish({ status: 'error', error: initial?.error ?? 'visual diagnostics inspection failed', records, rawSequenceGaps: rawSequenceGaps(records), timedOut: false }); return; }
        initial.result.forEach(appendRecord);
        snapshotPending = false;
        const existing = eligibleTerminal();
        if (existing) finish({ status: 'terminal', terminal: existing, records, rawSequenceGaps: rawSequenceGaps(records), transcriptTruncated, timedOut: false });
      } catch (error) {
        finish({ status: 'error', error: error instanceof Error ? error.message : String(error), records, rawSequenceGaps: rawSequenceGaps(records), transcriptTruncated, timedOut: false });
      }
    })();
    timer = setTimeout(() => finish({ status: 'timeout', records, rawSequenceGaps: rawSequenceGaps(records), transcriptTruncated, timedOut: true }), timeoutMs);
  });
  return result;
}

async function callOk(connection, method, params = {}) {
  const response = await connection.call(method, params);
  if (!response?.ok) throw new Error(response?.error ?? `${method} failed`);
  return response.result;
}

export async function runVisualDebug({ descriptorPath, windowId, surfaceId, timeoutMs = 5_000, outputDir, elementKeys = [] }) {
  const target = requireTarget(windowId, surfaceId);
  if (!descriptorPath) throw new Error('PAPERS_DEV_CONTROL_DESCRIPTOR or --descriptor is required');
  let descriptor;
  try { descriptor = await readDescriptor(descriptorPath); }
  catch { throw new Error('diagnostic mode unavailable: an existing control descriptor is required'); }
  const connection = await connectPapersControl(descriptor);
  const destination = outputDir ? resolve(outputDir) : await mkdtemp(join(tmpdir(), 'papers-visual-debug-'));
  await mkdir(destination, { recursive: true });
  try {
    const process = await callOk(connection, 'inspect.process');
    const windows = await callOk(connection, 'inspect.windows');
    if (!windows.some((window) => window.windowId === target.windowId)) throw new Error('explicit window target is not live');
    const surfaces = await callOk(connection, 'inspect.surfaces');
    if (!surfaces.some((surface) => surface.windowId === target.windowId && surface.surfaceId === target.surfaceId)) throw new Error('explicit surface target is not live in that window');
    const wait = await waitForVisualTerminal(connection, target, timeoutMs);
    if (wait.status === 'error') throw new Error(wait.error);
    const timeline = await callOk(connection, 'inspect.visual.timeline', { ...target, beforeMs: 10_000 });
    const windowDiagnostics = await callOk(connection, 'inspect.visual.diagnostics', { windowId: target.windowId });
    const windowCapture = await callOk(connection, 'capture.window', { windowId: target.windowId });
    let windowPng;
    if (windowCapture.png) windowPng = await readArtifact(connection, windowCapture.png);
    const keys = elementKeys.filter((key) => typeof key === 'string' && key.length > 0);
    const report = await callOk(connection, 'visual.report.create', {
      ...target,
      beforeMs: 10_000,
      elementKeys: keys,
      include: { surfaceCapture: true, elementCaptures: keys.length > 0, semanticElements: true, recentLifecycle: true, recentDiagnostics: true, timeline: true },
    });
    const reportBytes = await readArtifact(connection, { artifactId: report.artifactId, size: report.size, sha256: report.sha256 });
    const verified = verifyReportArchive(reportBytes, report);
    await writeFile(join(destination, 'report.zip'), reportBytes);
    if (windowPng) await writeFile(join(destination, 'window.png'), windowPng);
    await writeFile(join(destination, 'events.ndjson'), `${wait.records.map((record) => JSON.stringify(record)).join('\n')}${wait.records.length ? '\n' : ''}`);
    const summary = { schemaVersion: 1, process, target, terminal: wait.terminal ?? null, timedOut: wait.timedOut, eventTranscript: { count: wait.records.length, bytes: Buffer.byteLength(wait.records.map((record) => JSON.stringify(record)).join('\n')), truncated: wait.transcriptTruncated ?? false }, eventGaps: { observed: wait.rawSequenceGaps ?? [], ...reconcileEventSequences(wait.records, timeline, windowDiagnostics, target) }, timelineEntries: timeline.length, windowCapture: { ...windowCapture, png: windowCapture.png ? { ...windowCapture.png, verified: true } : undefined }, report: { ...report, verified: true, manifest: verified.manifest }, outputDir: destination };
    await writeFile(join(destination, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } finally {
    connection.close();
  }
}

function argValue(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function parseArgs(args) {
  const descriptorPath = argValue(args, '--descriptor') ?? process.env.PAPERS_DEV_CONTROL_DESCRIPTOR;
  const windowValue = argValue(args, '--window');
  const surfaceId = argValue(args, '--surface');
  const timeoutValue = argValue(args, '--timeout-ms');
  const elementKeys = args.flatMap((value, index) => value === '--element' && args[index + 1] ? [args[index + 1]] : []);
  return { descriptorPath, windowId: windowValue === undefined ? undefined : Number(windowValue), surfaceId, timeoutMs: timeoutValue === undefined ? undefined : Number(timeoutValue), outputDir: argValue(args, '--output-dir'), elementKeys };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runVisualDebug(parseArgs(process.argv.slice(2))).then((summary) => console.log(JSON.stringify(summary, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
