import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the standalone incident tool is intentionally plain ESM shipped with tools.
import { collectIncidentTranscript } from '../../tools/papersVisualIncident.mjs';

const target = { windowId: 4, surfaceId: 'surface-a' };

function fakeConnection() {
  const handlers = new Set<(frame: unknown) => void>();
  return {
    calls: [] as Array<{ method: string; params: unknown }>,
    call: async (method: string, params: unknown) => {
      const result = method === 'events.subscribe' ? { ok: true } : { ok: true, result: [] };
      return (Object.assign(result, { method, params }));
    },
    onEvent: (handler: (frame: unknown) => void) => { handlers.add(handler); return () => handlers.delete(handler); },
    emit: (frame: unknown) => handlers.forEach((handler) => handler(frame)),
  };
}

describe('bounded visual incident transcript', () => {
  it('captures exact-target events, deduplicates the snapshot, and reconciles gaps', async () => {
    const connection = fakeConnection();
    const pending = collectIncidentTranscript(connection, target, { durationMs: 30, maxRecords: 8, maxBytes: 16 * 1024 });
    connection.emit({ event: 'visual.diagnostic', payload: { sequence: 1, target, payload: { kind: 'uncaught-error', message: 'boom' } } });
    connection.emit({ event: 'visual.diagnostic', payload: { sequence: 3, target, payload: { kind: 'unhandled-rejection', message: 'later' } } });
    connection.emit({ event: 'visual.diagnostic', payload: { sequence: 9, target: { windowId: 99, surfaceId: 'other' }, payload: { kind: 'uncaught-error' } } });
    const result = await pending;
    expect(result.records.map((record: { sequence: number }) => record.sequence)).toEqual([1, 3]);
    expect(result.rawSequenceGaps).toEqual([{ from: 2, to: 2 }]);
    expect(result.eventGaps.unrecoverableGaps).toEqual([{ from: 2, to: 2, reason: 'not-in-current-target-history' }]);
  });

  it('stops cleanly on cancellation', async () => {
    const connection = fakeConnection(); const controller = new AbortController();
    const pending = collectIncidentTranscript(connection, target, { durationMs: 1000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
