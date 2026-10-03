import { describe, expect, it } from 'vitest';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  desktopEnvelope,
  normalizeWindowBounds,
  resolveWindowBounds,
  type DisplayArea,
} from '../../src/main/windowBounds';

/** A three-monitor row: the primary flanked by one screen to each side, so
 * the left-hand display has a negative origin exactly as Windows reports. */
const THREE_MONITORS: DisplayArea[] = [
  { x: -1920, y: 0, width: 1920, height: 1080 },
  { x: 0, y: 0, width: 2560, height: 1440 },
  { x: 2560, y: 0, width: 1920, height: 1080 },
];

const PRIMARY_ONLY: DisplayArea[] = [{ x: 0, y: 0, width: 2560, height: 1440 }];

describe('normalizeWindowBounds', () => {
  it('rejects malformed records rather than throwing at startup', () => {
    expect(normalizeWindowBounds(undefined)).toBeNull();
    expect(normalizeWindowBounds(null)).toBeNull();
    expect(normalizeWindowBounds('1360x860')).toBeNull();
    expect(normalizeWindowBounds({ x: 0, y: 0, width: 1360 })).toBeNull();
    expect(normalizeWindowBounds({ x: 0, y: 0, width: Number.NaN, height: 860 })).toBeNull();
    expect(normalizeWindowBounds({ x: 0, y: 0, width: 0, height: 860 })).toBeNull();
  });

  it('keeps negative origins, which a left-hand monitor legitimately has', () => {
    expect(normalizeWindowBounds({ x: -1920, y: -200, width: 6400, height: 1440 })).toEqual({
      x: -1920,
      y: -200,
      width: 6400,
      height: 1440,
    });
  });

  it('lifts an undersized rectangle to the minimum window size', () => {
    const bounds = normalizeWindowBounds({ x: 10, y: 10, width: 100, height: 50 });
    expect(bounds).toEqual({ x: 10, y: 10, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
  });
});

describe('desktopEnvelope', () => {
  it('spans every attached display', () => {
    expect(desktopEnvelope(THREE_MONITORS)).toEqual({ x: -1920, y: 0, width: 6400, height: 1440 });
  });

  it('is null with no displays', () => {
    expect(desktopEnvelope([])).toBeNull();
  });
});

describe('resolveWindowBounds', () => {
  it('preserves a rectangle spanning all three monitors exactly', () => {
    const spanning = { x: -1920, y: 0, width: 6400, height: 1080 };
    expect(resolveWindowBounds(spanning, THREE_MONITORS)).toEqual(spanning);
  });

  it('keeps a rectangle that spans a gap between mismatched monitor heights', () => {
    // Tall middle display: part of the window sits over dead space below the
    // shorter side monitors, which must not count as "off-screen".
    const spanning = { x: -1920, y: 0, width: 6400, height: 1200 };
    expect(resolveWindowBounds(spanning, THREE_MONITORS)).toEqual(spanning);
  });

  it('clamps onto the best-matching display when monitors are unplugged', () => {
    // Saved across three monitors, restored with only the primary attached.
    const spanning = { x: -1920, y: 0, width: 6400, height: 1080 };
    const resolved = resolveWindowBounds(spanning, PRIMARY_ONLY);
    expect(resolved).not.toBeNull();
    expect(resolved!.x).toBeGreaterThanOrEqual(0);
    expect(resolved!.y).toBeGreaterThanOrEqual(0);
    expect(resolved!.x + resolved!.width).toBeLessThanOrEqual(2560);
    expect(resolved!.y + resolved!.height).toBeLessThanOrEqual(1440);
  });

  it('recovers a window stranded entirely off-screen', () => {
    const stranded = { x: -9000, y: -9000, width: 1360, height: 860 };
    const resolved = resolveWindowBounds(stranded, PRIMARY_ONLY);
    expect(resolved).toEqual({ x: 0, y: 0, width: 1360, height: 860 });
  });

  it('keeps a window hanging slightly off the edge', () => {
    // ~76% visible: still easy to grab, so the exact rectangle is preserved.
    const mostlyOn = { x: 1400, y: 100, width: 1360, height: 860 };
    expect(resolveWindowBounds(mostlyOn, PRIMARY_ONLY)).toEqual(mostlyOn);
  });

  it('pulls back a window hanging more than half off the edge', () => {
    // ~41% visible: below the grabbable threshold, so it is clamped fully on.
    const mostlyOff = { x: 2000, y: 100, width: 1360, height: 860 };
    expect(resolveWindowBounds(mostlyOff, PRIMARY_ONLY)).toEqual({
      x: 1200,
      y: 100,
      width: 1360,
      height: 860,
    });
  });

  it('falls back to null so the caller can use its default size', () => {
    expect(resolveWindowBounds(null, THREE_MONITORS)).toBeNull();
    expect(resolveWindowBounds({ x: 0, y: 0, width: 1360, height: 860 }, [])).toBeNull();
  });
});
