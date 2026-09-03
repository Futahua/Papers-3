import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- the diagnostic runner is intentionally a plain ESM CLI.
import { readArtifact, waitForVisualTerminal } from '../../tools/papersVisualDebug.mjs';

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
