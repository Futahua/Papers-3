import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- the diagnostic runner is intentionally a plain ESM CLI.
import { readArtifact, reconcileEventSequences, waitForVisualTerminal } from '../../tools/papersVisualDebug.mjs';

const target = { windowId: 7, surfaceId: 'surface-a' };
const lifecycle = (phase: 'layout-stable' | 'render-failed', sequence = 1) => ({
  sequence, observedAt: '2026-09-03T00:00:00.000Z', target,
  payload: { kind: 'lifecycle', phase },
});

function connectionFor(initial: unknown[] = [], onSubscribe?: (emit: (frame: unknown) => void) => void) {
  const listeners = new Set<(frame: unknown) => void>();
  return {
    call: async (method: string) => {
      if (method === 'inspect.visual.diagnostics') return { ok: true, result: initial };
      if (method === 'events.subscribe') { onSubscribe?.((frame) => listeners.forEach((listener) => listener(frame))); return { ok: true, result: { subscribed: ['visual.lifecycle', 'visual.diagnostic'] } }; }
      throw new Error(`unexpected ${method}`);
    },
    onEvent(listener: (frame: unknown) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

describe('read-only visual debug runner primitives', () => {
  it('requires exact target and completes from an event without polling', async () => {
    let subscribed = false;
    const connection = connectionFor([], (emit) => { subscribed = true; setTimeout(() => emit({ type: 'event', event: 'visual.lifecycle', payload: lifecycle('layout-stable') }), 5); });
    await expect(waitForVisualTerminal(connection, target, 100)).resolves.toMatchObject({ status: 'terminal', terminal: { payload: { phase: 'layout-stable' } } });
    expect(subscribed).toBe(true);
  });

  it('returns already-terminal history immediately and times out with no event', async () => {
    await expect(waitForVisualTerminal(connectionFor([lifecycle('render-failed', 4)]), target, 100)).resolves.toMatchObject({ status: 'terminal', timedOut: false });
    await expect(waitForVisualTerminal(connectionFor(), target, 10)).resolves.toMatchObject({ status: 'timeout', timedOut: true });
  });

  it('does not accept a terminal record from before the latest navigation', async () => {
    const connection = connectionFor([
      lifecycle('layout-stable', 10),
      { sequence: 11, observedAt: '2026-09-03T00:00:00.000Z', target, payload: { kind: 'lifecycle', phase: 'navigation-started' } },
    ], (emit) => setTimeout(() => emit({ type: 'event', event: 'visual.lifecycle', payload: lifecycle('layout-stable', 12) }), 5));
    await expect(waitForVisualTerminal(connection, target, 100)).resolves.toMatchObject({ status: 'terminal', terminal: { sequence: 12 } });
  });

  it('chooses the newest terminal when a live event arrives during the snapshot', async () => {
    const listeners = new Set<(frame: unknown) => void>();
    const connection = {
      onEvent(listener: (frame: unknown) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      call: async (method: string) => {
        if (method === 'events.subscribe') return { ok: true, result: {} };
        if (method === 'inspect.visual.diagnostics') {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ok: true, result: [lifecycle('layout-stable', 10)] };
        }
        throw new Error(`unexpected ${method}`);
      },
    };
    setTimeout(() => listeners.forEach((listener) => listener({ type: 'event', event: 'visual.lifecycle', payload: lifecycle('render-failed', 15) })), 2);
    await expect(waitForVisualTerminal(connection, target, 100)).resolves.toMatchObject({ status: 'terminal', terminal: { sequence: 15, payload: { phase: 'render-failed' } } });
  });

  it('freezes the timeout result when the snapshot resolves late', async () => {
    const connection = {
      onEvent: () => () => {},
      call: async (method: string) => {
        if (method === 'events.subscribe') return { ok: true, result: {} };
        if (method === 'inspect.visual.diagnostics') {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { ok: true, result: [lifecycle('layout-stable', 10)] };
        }
        throw new Error(`unexpected ${method}`);
      },
    };
    const result = await waitForVisualTerminal(connection, target, 5);
    expect(result).toMatchObject({ status: 'timeout', timedOut: true, records: [] });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(result.records).toEqual([]);
  });

  it('reconciles target history and distinguishes a known other-surface sequence', () => {
    const received = [lifecycle('layout-stable', 10), lifecycle('render-failed', 12)];
    expect(reconcileEventSequences(received, [{ eventSeq: 11 }], [
      { sequence: 11, target: { windowId: 7, surfaceId: 'surface-b' } },
    ])).toEqual({ recoveredSequences: [], crossSurfaceSequences: [11], unrecoverableGaps: [] });
    expect(reconcileEventSequences(received, [{ eventSeq: 11 }])).toEqual({ recoveredSequences: [11], crossSurfaceSequences: [], unrecoverableGaps: [] });
    expect(reconcileEventSequences(
      [lifecycle('layout-stable', 10), lifecycle('render-failed', 15)],
      [{ eventSeq: 14 }],
      [
        { sequence: 12, target: { windowId: 7, surfaceId: 'surface-b' } },
        { sequence: 13, target },
      ],
    )).toEqual({ recoveredSequences: [13, 14], crossSurfaceSequences: [12], unrecoverableGaps: [{ from: 11, to: 11, reason: 'not-in-current-target-history' }] });
  });

  it('bounds the session-local live transcript deterministically', async () => {
    const connection = connectionFor([], (emit) => {
      for (let sequence = 1; sequence <= 700; sequence += 1) emit({ type: 'event', event: 'visual.diagnostic', payload: {
        sequence, observedAt: '2026-09-03T00:00:00.000Z', target, payload: { kind: 'console', level: 'info', message: `event-${sequence}` },
      } });
      emit({ type: 'event', event: 'visual.lifecycle', payload: lifecycle('layout-stable', 701) });
    });
    await expect(waitForVisualTerminal(connection, target, 100)).resolves.toMatchObject({ status: 'terminal', transcriptTruncated: true });
  });

  it('reassembles chunks and verifies the advertised artifact hash and size', async () => {
    const source = Buffer.from('artifact bytes');
    const digest = createHash('sha256').update(source).digest('hex');
    const connection = { call: async (_method: string, params: { offset: number }) => ({ ok: true, result: {
      offset: params.offset, nextOffset: Math.min(source.length, params.offset + 3), done: params.offset + 3 >= source.length,
      bytesBase64: source.subarray(params.offset, params.offset + 3).toString('base64'),
    } }) };
    await expect(readArtifact(connection, { artifactId: 'va-11111111-1111-4111-8111-111111111111', size: source.length, sha256: digest })).resolves.toEqual(source);
  });
});
