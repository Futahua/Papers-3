import { describe, expect, it } from 'vitest';
import { parseWindowLifecycleMessage } from '../../src/main/windows/windowLifecycleTypes';

const observation = {
  windowInstanceId: 'W0123456789abcdef',
  title: 'Editor',
  processId: 42,
  processPath: 'C:/Editor.exe',
  windowClass: 'EditorMain',
  state: 'normal',
  bounds: { x: 1, y: 2, width: 800, height: 600 },
};

describe('window lifecycle protocol', () => {
  it('accepts a complete baseline and an exact-instance event', () => {
    const baseline = parseWindowLifecycleMessage({ type: 'baseline', trackerSessionId: 'L0123456789abcdef0123456789abcdef', sequence: 1, complete: true, windows: [observation] });
    expect(baseline?.type).toBe('baseline');
    const event = parseWindowLifecycleMessage({ type: 'event', trackerSessionId: 'L0123456789abcdef0123456789abcdef', sequence: 2, kind: 'destroy', windowInstanceId: observation.windowInstanceId });
    expect(event).toMatchObject({ kind: 'destroy', windowInstanceId: observation.windowInstanceId });
  });

  it('rejects raw HWNDs, malformed ids and incomplete baselines', () => {
    expect(parseWindowLifecycleMessage({ type: 'event', trackerSessionId: 'L0123456789abcdef0123456789abcdef', sequence: 2, kind: 'destroy', windowInstanceId: '1234' })).toBeNull();
    expect(parseWindowLifecycleMessage({ type: 'baseline', trackerSessionId: 'L0123456789abcdef0123456789abcdef', sequence: 1, complete: false, windows: [] })).toBeNull();
  });
});
