import type { VisualElementObservation } from '@shared/visualSemanticKeys';

export type VisualAssertion =
  | { kind: 'visible'; elementKey: string }
  | { kind: 'not-clipped'; elementKey: string; maxClippedPercent: number }
  | { kind: 'inside'; elementKey: string; containerKey: string }
  | { kind: 'no-overlap'; a: string; b: string; maxIntersectionPercent: number }
  | { kind: 'min-contrast'; elementKey: string; ratio: number };

export interface VisualAssertionResult {
  kind: VisualAssertion['kind'];
  passed: boolean;
  reason?: 'missing-element' | 'not-visible' | 'clipped' | 'outside-container' | 'overlap' | 'unknown-contrast' | 'contrast-too-low';
}

function contains(container: VisualElementObservation, element: VisualElementObservation): boolean {
  const outer = container.boundsCss;
  const inner = element.boundsCss;
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function evaluateVisualAssertions(
  elements: readonly VisualElementObservation[],
  assertions: readonly VisualAssertion[],
): { allPassed: boolean; assertions: VisualAssertionResult[] } {
  const byKey = new Map(elements.map((element) => [element.key, element]));
  const results = assertions.map((assertion): VisualAssertionResult => {
    if (assertion.kind === 'visible') {
      const element = byKey.get(assertion.elementKey);
      return element ? { kind: assertion.kind, passed: element.visible, ...(element.visible ? {} : { reason: 'not-visible' as const }) }
        : { kind: assertion.kind, passed: false, reason: 'missing-element' };
    }
    if (assertion.kind === 'not-clipped') {
      const element = byKey.get(assertion.elementKey);
      if (!element) return { kind: assertion.kind, passed: false, reason: 'missing-element' };
      return element.clippedPercent <= assertion.maxClippedPercent
        ? { kind: assertion.kind, passed: true }
        : { kind: assertion.kind, passed: false, reason: 'clipped' };
    }
    if (assertion.kind === 'inside') {
      const element = byKey.get(assertion.elementKey);
      const container = byKey.get(assertion.containerKey);
      if (!element || !container) return { kind: assertion.kind, passed: false, reason: 'missing-element' };
      return contains(container, element)
        ? { kind: assertion.kind, passed: true }
        : { kind: assertion.kind, passed: false, reason: 'outside-container' };
    }
    if (assertion.kind === 'no-overlap') {
      const first = byKey.get(assertion.a);
      const second = byKey.get(assertion.b);
      if (!first || !second) return { kind: assertion.kind, passed: false, reason: 'missing-element' };
      const overlap = first.overlapKeys.includes(second.key) || second.overlapKeys.includes(first.key);
      return !overlap || assertion.maxIntersectionPercent >= 100
        ? { kind: assertion.kind, passed: !overlap }
        : { kind: assertion.kind, passed: false, reason: 'overlap' };
    }
    const element = byKey.get(assertion.elementKey);
    if (!element) return { kind: assertion.kind, passed: false, reason: 'missing-element' };
    if (element.contrast.status === 'unknown') return { kind: assertion.kind, passed: false, reason: 'unknown-contrast' };
    return element.contrast.ratio >= assertion.ratio
      ? { kind: assertion.kind, passed: true }
      : { kind: assertion.kind, passed: false, reason: 'contrast-too-low' };
  });
  return { allPassed: results.every((result) => result.passed), assertions: results };
}
