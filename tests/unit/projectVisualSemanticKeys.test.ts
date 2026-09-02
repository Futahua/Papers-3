import { describe, expect, it, vi } from 'vitest';

import {
  installProjectVisualSemanticKeyObserver,
} from '../../src/preload/projectVisualSemanticKeys';
import { VISUAL_SEMANTIC_KEYS_CHANNEL } from '../../src/shared/visualSemanticKeys';

describe('project semantic-key observation', () => {
  it('observes only the fixed Papers attribute and coalesces each mutation batch', () => {
    const nodes = [{ key: 'canvas.root' }, { key: 'toolbar.primary' }];
    const document = {
      querySelectorAll: vi.fn((selector: string) => {
        expect(selector).toBe('[data-papers-visual-key]');
        return nodes.map((node) => ({ getAttribute: () => node.key }));
      }),
      addEventListener: vi.fn(),
    } as unknown as Document;
    let callback: (() => void) | undefined;
    const MutationObserver = class {
      constructor(next: () => void) { callback = next; }
      observe = vi.fn();
    } as unknown as typeof globalThis.MutationObserver;
    const send = vi.fn();

    installProjectVisualSemanticKeyObserver({ send }, { document, MutationObserver });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(VISUAL_SEMANTIC_KEYS_CHANNEL, {
      keys: ['canvas.root', 'toolbar.primary'],
    });
    callback?.();
    expect(send).toHaveBeenCalledTimes(1);

    nodes.push({ key: 'status.banner' });
    callback?.();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(VISUAL_SEMANTIC_KEYS_CHANNEL, {
      keys: ['canvas.root', 'toolbar.primary', 'status.banner'],
    });
  });
});
