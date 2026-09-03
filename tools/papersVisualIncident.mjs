#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';
import { reconcileEventSequences } from './papersVisualDebug.mjs';

const MAX_DURATION_MS = 120_000;
const MAX_RECORDS = 1024;
const MAX_BYTES = 4 * 1024 * 1024;

function targetIsValid(target) { return Number.isInteger(target?.windowId) && target.windowId > 0 && typeof target.surfaceId === 'string' && target.surfaceId.length > 0 && target.surfaceId.length <= 128; }
function targetMatches(record, target) { return record?.target?.windowId === target.windowId && record?.target?.surfaceId === target.surfaceId; }
function rawGaps(records) { const values = [...new Set(records.map((record) => record.sequence).filter(Number.isInteger))].sort((a, b) => a - b); const gaps = []; for (let i = 1; i < values.length; i += 1) if (values[i] > values[i - 1] + 1) gaps.push({ from: values[i - 1] + 1, to: values[i] - 1 }); return gaps; }

/** Collect a bounded, session-local event transcript without extending Papers' runtime history. */
export async function collectIncidentTranscript(connection, target, { durationMs = 60_000, maxRecords = MAX_RECORDS, maxBytes = MAX_BYTES, signal } = {}) {
  if (!targetIsValid(target)) throw new Error('an explicit window and surface target are required');
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) throw new Error(`duration-ms must be an integer from 1 to ${MAX_DURATION_MS}`);
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_BYTES) throw new Error('incident transcript bounds are invalid');
  const records = []; const liveRecords = []; const seen = new Set(); let bytes = 0; let liveBytes = 0; let truncated = false; let stopEvents = () => undefined; let timer; let settled = false;
  const append = (record, live = false) => {
    if (!targetMatches(record, target) || !Number.isInteger(record.sequence) || seen.has(record.sequence)) return;
    seen.add(record.sequence); const recordBytes = Buffer.byteLength(JSON.stringify(record)); if (live) { liveRecords.push(record); liveBytes += recordBytes; } records.push(record); bytes += recordBytes;
    while (seen.size > maxRecords * 4) seen.delete(seen.values().next().value);
    while (records.length > maxRecords || bytes > maxBytes) { const removed = records.shift(); bytes -= removed ? Buffer.byteLength(JSON.stringify(removed)) : 0; truncated = true; }
    while (liveRecords.length > maxRecords || liveBytes > maxBytes) { const removed = liveRecords.shift(); liveBytes -= removed ? Buffer.byteLength(JSON.stringify(removed)) : 0; truncated = true; }
  };
  const abortError = () => Object.assign(new Error('incident transcript cancelled'), { name: 'AbortError' });
  try {
    if (signal?.aborted) throw abortError();
    stopEvents = connection.onEvent((frame) => { if (!settled && ['visual.lifecycle', 'visual.diagnostic'].includes(frame?.event)) append(frame.payload, true); });
    const subscription = await connection.call('events.subscribe', { events: ['visual.lifecycle', 'visual.diagnostic'], visualTarget: target });
    if (!subscription?.ok) throw new Error(subscription?.error ?? 'visual event subscription failed');
    const initial = await connection.call('inspect.visual.diagnostics', target);
    if (!initial?.ok) throw new Error(initial?.error ?? 'visual diagnostics inspection failed');
    for (const record of initial.result ?? []) append(record);
    if (signal?.aborted) throw abortError();
    const result = await new Promise((resolveResult, rejectResult) => {
      const finish = (value, error) => { if (settled) return; settled = true; clearTimeout(timer); stopEvents(); signal?.removeEventListener('abort', onAbort); error ? rejectResult(error) : resolveResult(value); };
      const onAbort = () => finish(undefined, abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish({ records: [...records].sort((a, b) => a.sequence - b.sequence), liveRecords: [...liveRecords], bytes, truncated, timedOut: false }), durationMs);
    });
    const reconciled = reconcileEventSequences(result.liveRecords, result.records, result.records, target);
    return { ...result, durationMs, target, rawSequenceGaps: rawGaps(result.records), eventGaps: reconciled };
  } finally {
    settled = true; clearTimeout(timer); stopEvents();
  }
}

export async function runVisualIncident({ descriptorPath, windowId, surfaceId, durationMs = 60_000, outputDir, signal }) {
  if (!descriptorPath) throw new Error('PAPERS_DEV_CONTROL_DESCRIPTOR or --descriptor is required');
  if (!targetIsValid({ windowId, surfaceId })) throw new Error('an explicit --window integer and --surface id are required');
  let descriptor; try { descriptor = await readDescriptor(descriptorPath); } catch { throw new Error('diagnostic mode unavailable: an existing control descriptor is required'); }
  let connection; try { connection = await connectPapersControl(descriptor); } catch { throw new Error('diagnostic mode unavailable: the existing control endpoint is not reachable'); }
  const destination = outputDir ? resolve(outputDir) : await mkdtemp(join(tmpdir(), 'papers-visual-incident-')); await mkdir(destination, { recursive: true });
  try {
    const process = await connection.call('inspect.process'); const windows = await connection.call('inspect.windows'); const surfaces = await connection.call('inspect.surfaces');
    if (!process?.ok || !windows?.ok || !surfaces?.ok || !windows.result.some((window) => window.windowId === windowId) || !surfaces.result.some((surface) => surface.windowId === windowId && surface.surfaceId === surfaceId)) throw new Error('explicit incident target is not live');
    const transcript = await collectIncidentTranscript(connection, { windowId, surfaceId }, { durationMs, signal });
    await writeFile(join(destination, 'events.ndjson'), `${transcript.records.map((record) => JSON.stringify(record)).join('\n')}${transcript.records.length ? '\n' : ''}`);
    const summary = { schemaVersion: 1, target: { windowId, surfaceId }, durationMs, transcript: { count: transcript.records.length, bytes: transcript.bytes, truncated: transcript.truncated }, timedOut: transcript.timedOut, eventGaps: { observed: transcript.rawSequenceGaps, ...transcript.eventGaps }, outputDir: destination };
    await writeFile(join(destination, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`); return summary;
  } finally { connection.close(); }
}

function argValue(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) runVisualIncident({ descriptorPath: argValue(process.argv.slice(2), '--descriptor') ?? process.env.PAPERS_DEV_CONTROL_DESCRIPTOR, windowId: Number(argValue(process.argv.slice(2), '--window')), surfaceId: argValue(process.argv.slice(2), '--surface'), durationMs: Number(argValue(process.argv.slice(2), '--duration-ms') ?? 60000), outputDir: argValue(process.argv.slice(2), '--output-dir') }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
