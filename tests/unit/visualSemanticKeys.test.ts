import { describe, expect, it } from 'vitest';

import {
  createVisualSemanticKeyRegistry,
  visualSemanticKeyListSchema,
  visualSemanticKeySchema,
} from '../../src/shared/visualSemanticKeys';

describe('visual semantic-key contract', () => {
  it('accepts bounded opaque identifiers and returns them in observed order', () => {
    const registry = createVisualSemanticKeyRegistry();
    expect(registry.replaceObserved(['canvas.root', 'toolbar.primary'])).toEqual([
      'canvas.root', 'toolbar.primary',
    ]);
    expect(registry.snapshot()).toEqual(['canvas.root', 'toolbar.primary']);
    expect(registry.snapshot(['toolbar.primary'])).toEqual(['toolbar.primary']);
  });

  it('rejects invalid or duplicate keys without replacing the last valid observation', () => {
    const registry = createVisualSemanticKeyRegistry();
    registry.replaceObserved(['canvas.root']);
    expect(() => visualSemanticKeySchema.parse('button#save')).toThrow();
    expect(() => visualSemanticKeyListSchema.parse(['canvas.root', 'canvas.root'])).toThrow(/duplicated/);
    expect(() => registry.replaceObserved(['canvas.root', 'canvas.root'])).toThrow(/duplicated/);
    expect(registry.snapshot()).toEqual(['canvas.root']);
  });

  it('keeps the same key independent across separate surface registries', () => {
    const firstSurface = createVisualSemanticKeyRegistry();
    const secondSurface = createVisualSemanticKeyRegistry();
    firstSurface.replaceObserved(['canvas.root']);
    secondSurface.replaceObserved(['canvas.root', 'toolbar.primary']);
    expect(firstSurface.snapshot()).toEqual(['canvas.root']);
    expect(secondSurface.snapshot()).toEqual(['canvas.root', 'toolbar.primary']);
  });

  it('does not accept selectors, XPath, scripts, or unbounded metadata', () => {
    const registry = createVisualSemanticKeyRegistry();
    expect(() => registry.replaceObserved([{ selector: '[data-x]' }])).toThrow();
    expect(() => registry.replaceObserved(['//button'])).toThrow();
    expect(() => registry.replaceObserved(['javascript:alert(1)'])).toThrow();
  });
});
