import { describe, expect, it } from 'vitest';

import { createVisualDiagnosticBuffer, redactDiagnosticText } from '../../src/main/visual/visualDiagnostics';

describe('bounded visual diagnostic buffer', () => {
  it('keeps only the most recent records and preserves sequence numbers', () => {
    const buffer = createVisualDiagnosticBuffer({ capacity: 2, now: () => new Date('2026-09-02T00:00:00.000Z') });
    buffer.append({ windowId: 1, surfaceId: 'surface-a' }, { kind: 'lifecycle', phase: 'dom-ready' });
    buffer.append({ windowId: 1, surfaceId: 'surface-a' }, { kind: 'lifecycle', phase: 'state-hydrated' });
    buffer.append({ windowId: 1, surfaceId: 'surface-a' }, { kind: 'lifecycle', phase: 'first-paint' });
    expect(buffer.snapshot().map((record) => record.sequence)).toEqual([2, 3]);
    expect(buffer.snapshot()[0]).toMatchObject({ observedAt: '2026-09-02T00:00:00.000Z', target: { windowId: 1 } });
  });

  it('accepts every planned lifecycle and failure class', () => {
    const buffer = createVisualDiagnosticBuffer();
    const payloads = [
      { kind: 'lifecycle', phase: 'navigation-started' },
      { kind: 'lifecycle', phase: 'dom-ready' },
      { kind: 'lifecycle', phase: 'state-hydrated' },
      { kind: 'lifecycle', phase: 'first-paint' },
      { kind: 'lifecycle', phase: 'layout-stable' },
      { kind: 'lifecycle', phase: 'render-failed' },
      { kind: 'console', level: 'error', message: 'render failed' },
      { kind: 'uncaught-error', message: 'uncaught' },
      { kind: 'unhandled-rejection', message: 'rejected' },
      { kind: 'navigation-failed', errorCode: -2, message: 'failed' },
      { kind: 'resource-failed', resourceKind: 'script', errorCode: 404, message: 'missing' },
      { kind: 'renderer-gone', reason: 'crashed' },
      { kind: 'hydration-failed', message: 'bad state' },
    ] as const;
    for (const payload of payloads) buffer.append({ windowId: 1 }, payload);
    expect(buffer.snapshot()).toHaveLength(payloads.length);
  });

  it('rejects unknown fields and malformed targets instead of widening the record', () => {
    const buffer = createVisualDiagnosticBuffer();
    expect(() => buffer.append({ windowId: 1 }, { kind: 'console', level: 'error', message: 'x', sourceUrl: 'https://secret' })).toThrow();
    expect(() => buffer.append({ windowId: 1, surfaceId: '' }, { kind: 'console', level: 'error', message: 'x' })).toThrow();
  });

  it('redacts URLs, local paths and credential-like assignments', () => {
    expect(redactDiagnosticText('file:///C:/private/app.js C:\\Users\\secret\\x.js token=abc123')).toBe('<url> <path> token=<redacted>');
  });

  it('does not record by itself and clear removes only diagnostic evidence', () => {
    const buffer = createVisualDiagnosticBuffer({ capacity: 1 });
    expect(buffer.snapshot()).toEqual([]);
    buffer.append({ windowId: 1 }, { kind: 'console', level: 'warn', message: 'warning' });
    buffer.clear();
    expect(buffer.snapshot()).toEqual([]);
  });

  it('bounds capacity configuration', () => {
    expect(() => createVisualDiagnosticBuffer({ capacity: 0 })).toThrow();
    expect(() => createVisualDiagnosticBuffer({ capacity: 513 })).toThrow();
  });
});
