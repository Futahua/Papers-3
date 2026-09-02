import { describe, expect, it } from 'vitest';

import { createVisualDiagnosticBuffer } from '../../src/main/visual/visualDiagnostics';
import { createVisualTimeline } from '../../src/main/visual/visualTimeline';

describe('bounded visual timelines', () => {
  it('enforces count and age bounds while retaining correlated revisions', () => {
    let timestamp = new Date('2026-09-02T00:00:00.000Z');
    const timeline = createVisualTimeline({ now: () => timestamp, maxEvents: 2 });
    const buffer = createVisualDiagnosticBuffer({ now: () => timestamp });
    const target = { windowId: 4, surfaceId: 'surface-a' };
    const first = buffer.append(target, { kind: 'lifecycle', phase: 'navigation-started' });
    const second = buffer.append(target, { kind: 'lifecycle', phase: 'dom-ready' });
    const third = buffer.append(target, { kind: 'lifecycle', phase: 'first-paint' });
    for (const record of [first, second, third]) {
      timeline.append(record, {
        renderCycleId: '11111111-1111-4111-8111-111111111111',
        documentStateRevision: 'revision-1', layoutEpoch: 3, workspaceTopologyRevision: 7,
      });
    }
    expect(timeline.snapshot()).toHaveLength(2);
    expect(timeline.snapshot().map((entry) => entry.eventSeq)).toEqual([2, 3]);
    expect(timeline.snapshot()[0]).toMatchObject({
      target, renderCycleId: '11111111-1111-4111-8111-111111111111',
      documentStateRevision: 'revision-1', layoutEpoch: 3, workspaceTopologyRevision: 7,
    });
    timestamp = new Date('2026-09-02T00:00:11.000Z');
    expect(timeline.snapshot()).toEqual([]);
    expect(() => timeline.snapshot(10_001)).toThrow(/lookback bound/);
  });
});
