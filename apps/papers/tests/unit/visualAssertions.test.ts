import { describe, expect, it } from 'vitest';

import { evaluateVisualAssertions } from '../../src/main/visual/visualAssertions';
import type { VisualElementObservation } from '../../src/shared/visualSemanticKeys';

function element(key: string, overrides: Partial<VisualElementObservation> = {}): VisualElementObservation {
  return {
    key, boundsCss: { x: 0, y: 0, width: 100, height: 100 },
    boundsDevice: { x: 0, y: 0, width: 100, height: 100 }, visible: true,
    visibilityReasons: [], clippedPercent: 0, opacity: 1, overlapKeys: [],
    contrast: { status: 'known', ratio: 7 }, ...overrides,
  };
}

describe('declarative visual assertions', () => {
  it('evaluates visible, containment, overlap, clipping, and contrast without selectors', () => {
    const result = evaluateVisualAssertions([
      element('container', { boundsCss: { x: 0, y: 0, width: 200, height: 200 }, boundsDevice: { x: 0, y: 0, width: 200, height: 200 } }),
      element('child', { boundsCss: { x: 10, y: 10, width: 20, height: 20 }, boundsDevice: { x: 10, y: 10, width: 20, height: 20 }, overlapKeys: ['other'] }),
      element('other', { boundsCss: { x: 20, y: 20, width: 20, height: 20 }, boundsDevice: { x: 20, y: 20, width: 20, height: 20 }, overlapKeys: ['child'], contrast: { status: 'unknown' } }),
    ], [
      { kind: 'visible', elementKey: 'child' },
      { kind: 'inside', elementKey: 'child', containerKey: 'container' },
      { kind: 'no-overlap', a: 'child', b: 'other', maxIntersectionPercent: 0 },
      { kind: 'min-contrast', elementKey: 'child', ratio: 4.5 },
    ]);
    expect(result).toEqual({ allPassed: false, assertions: [
      { kind: 'visible', passed: true }, { kind: 'inside', passed: true },
      { kind: 'no-overlap', passed: false, reason: 'overlap' }, { kind: 'min-contrast', passed: true },
    ] });
  });

  it('uses actual intersection percentage rather than the descriptive overlap list', () => {
    const first = element('first', { boundsCss: { x: 0, y: 0, width: 100, height: 100 }, boundsDevice: { x: 0, y: 0, width: 100, height: 100 }, overlapKeys: [] });
    const second = element('second', { boundsCss: { x: 75, y: 0, width: 100, height: 100 }, boundsDevice: { x: 75, y: 0, width: 100, height: 100 }, overlapKeys: [] });
    expect(evaluateVisualAssertions([first, second], [{ kind: 'no-overlap', a: 'first', b: 'second', maxIntersectionPercent: 24 }]).allPassed).toBe(false);
    expect(evaluateVisualAssertions([first, second], [{ kind: 'no-overlap', a: 'first', b: 'second', maxIntersectionPercent: 25 }]).allPassed).toBe(true);
    expect(evaluateVisualAssertions([first, second], [{ kind: 'no-overlap', a: 'first', b: 'second', maxIntersectionPercent: 100 }]).allPassed).toBe(true);
  });

  it('fails closed for missing, clipped, and unknown contrast evidence', () => {
    const result = evaluateVisualAssertions([element('hidden', { visible: false, visibilityReasons: ['display-none'], clippedPercent: 80, contrast: { status: 'unknown' } })], [
      { kind: 'visible', elementKey: 'missing' },
      { kind: 'visible', elementKey: 'hidden' },
      { kind: 'not-clipped', elementKey: 'hidden', maxClippedPercent: 0 },
      { kind: 'min-contrast', elementKey: 'hidden', ratio: 4.5 },
    ]);
    expect(result.allPassed).toBe(false);
    expect(result.assertions.map((assertion) => assertion.reason)).toEqual(['missing-element', 'not-visible', 'clipped', 'unknown-contrast']);
  });
});
