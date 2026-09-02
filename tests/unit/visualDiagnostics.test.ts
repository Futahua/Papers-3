import { describe, expect, it, vi } from 'vitest';

import { createVisualDiagnosticBuffer, redactDiagnosticText } from '../../src/main/visual/visualDiagnostics';

describe('bounded visual diagnostic buffer', () => {
  it('keeps only the most recent records and preserves sequence numbers', () => {
    const buffer = createVisualDiagnosticBuffer({ capacity: 2, now: () => new Date('2026-09-02T00:00:00.000Z') });
    buffer.append({ windowId: 1, surfaceId: 'surface-a' }, { kind: 'lifecycle', phase: 'dom-ready' });
    buffer.append({ windowId: 1, surfaceId: 'surface-a' }, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1',
    });
    buffer.append({ windowId: 1, surfaceId: 'surface-a' }, { kind: 'lifecycle', phase: 'first-paint' });
    expect(buffer.snapshot().map((record) => record.sequence)).toEqual([2, 3]);
    expect(buffer.snapshot()[0]).toMatchObject({ observedAt: '2026-09-02T00:00:00.000Z', target: { windowId: 1 } });
  });

  it('accepts every planned lifecycle and failure class', () => {
    const buffer = createVisualDiagnosticBuffer();
    const payloads = [
      { kind: 'lifecycle', phase: 'navigation-started' },
      { kind: 'lifecycle', phase: 'dom-ready' },
      { kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1' },
      { kind: 'lifecycle', phase: 'first-paint' },
      { kind: 'lifecycle', phase: 'layout-stable' },
      { kind: 'lifecycle', phase: 'render-failed' },
      { kind: 'lifecycle', phase: 'render-failed', revision: 'rev-1', stage: 'parse', code: 'bad-state' },
      { kind: 'console', level: 'error', message: 'render failed' },
      { kind: 'uncaught-error', message: 'uncaught' },
      { kind: 'unhandled-rejection', message: 'rejected' },
      { kind: 'navigation-failed', errorCode: -2, message: 'failed' },
      { kind: 'resource-failed', resourceKind: 'script', errorCode: 404, message: 'missing' },
      { kind: 'renderer-gone', reason: 'crashed' },
      { kind: 'hydration-failed', stage: 'parse', code: 'bad-state' },
    ] as const;
    for (const payload of payloads) buffer.append({ windowId: 1 }, payload);
    expect(buffer.snapshot()).toHaveLength(payloads.length);
  });

  it('requires an opaque revision for hydration and keeps summary metadata bounded', () => {
    const buffer = createVisualDiagnosticBuffer();
    buffer.append({ windowId: 1 }, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1', summary: { cards: 3 },
    });
    buffer.append({ windowId: 1 }, {
      kind: 'hydration-failed', revision: 'rev-1', stage: 'parse', code: 'invalid-envelope',
    });
    expect(() => buffer.append({ windowId: 1 }, { kind: 'lifecycle', phase: 'state-hydrated' })).toThrow();
    expect(() => buffer.append({ windowId: 1 }, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'C:\\private\\state.json',
    })).toThrow();
    expect(() => buffer.append({ windowId: 1 }, {
      kind: 'hydration-failed', stage: 'parse', code: 'bad/code',
    })).toThrow();
    buffer.append({ windowId: 1 }, {
      kind: 'lifecycle', phase: 'render-failed', revision: 'rev-1', stage: 'parse', code: 'invalid-envelope',
    });
    expect(() => buffer.append({ windowId: 1 }, {
      kind: 'lifecycle', phase: 'render-failed', detail: 'layout-stability-timeout',
      revision: 'rev-1', stage: 'parse', code: 'invalid-envelope',
    })).toThrow();
    expect(buffer.snapshot()[0]?.payload).toMatchObject({
      phase: 'state-hydrated', revision: 'rev-1', summary: { cards: 3 },
    });
  });

  it('rejects unknown fields and malformed targets instead of widening the record', () => {
    const buffer = createVisualDiagnosticBuffer();
    expect(() => buffer.append({ windowId: 1 }, { kind: 'console', level: 'error', message: 'x', sourceUrl: 'https://secret' })).toThrow();
    expect(() => buffer.append({ windowId: 1, surfaceId: '' }, { kind: 'console', level: 'error', message: 'x' })).toThrow();
  });

  it('redacts URLs, local paths and credential-like assignments', () => {
    expect(redactDiagnosticText('file:///C:/private/app.js C:\\Users\\secret\\x.js token=abc123')).toBe('<url> <path> token=<redacted>');
    expect(redactDiagnosticText('C:\\Program Files\\Papers\\out\\main.js')).toBe('<path>');
    expect(redactDiagnosticText('C:/Users/name/private/file.js \\\\server\\share\\private\\file.js token = abc123 password: secret-value apiKey="secret"')).toBe('<path> <path> token=<redacted> password=<redacted> apiKey=<redacted>');
    expect(redactDiagnosticText('data:text/plain,private-payload mailto:user@example.com custom-scheme:opaque-value')).toBe('<url> <url> <url>');
    expect(redactDiagnosticText('net::ERR_FAILED https://secret custom::ERR_PRIVATE papers-backpack::ERR_SECRET')).toBe('net::ERR_FAILED <url> <url> <url>');
  });

  it('does not record by itself and clear removes only diagnostic evidence', () => {
    const buffer = createVisualDiagnosticBuffer({ capacity: 1 });
    expect(buffer.snapshot()).toEqual([]);
    buffer.append({ windowId: 1 }, { kind: 'console', level: 'warn', message: 'warning' });
    buffer.clear();
    expect(buffer.snapshot()).toEqual([]);
  });

  it('publishes only after a schema-valid record is retained', () => {
    const onAppend = vi.fn();
    const buffer = createVisualDiagnosticBuffer({ onAppend });

    const record = buffer.append({ windowId: 1 }, { kind: 'console', level: 'warn', message: 'warning' });

    expect(onAppend).toHaveBeenCalledWith(record);
    expect(onAppend).toHaveBeenCalledOnce();
    expect(() => buffer.append({ windowId: 1 }, { kind: 'console', level: 'error', message: 'x', extra: true })).toThrow();
    expect(onAppend).toHaveBeenCalledOnce();
  });

  it('bounds capacity configuration', () => {
    expect(() => createVisualDiagnosticBuffer({ capacity: 0 })).toThrow();
    expect(() => createVisualDiagnosticBuffer({ capacity: 513 })).toThrow();
  });
});
