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

  it('publishes bounded geometry for fixed semantic-key elements', () => {
    const element = {
      tagName: 'MAIN', isConnected: true, parentElement: null, textContent: 'Canvas',
      getAttribute: (name: string) => name === 'data-papers-visual-key' ? 'canvas.root' : null,
      getBoundingClientRect: () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 }),
    } as unknown as Element;
    const document = {
      documentElement: { clientWidth: 1000, clientHeight: 700 },
      querySelectorAll: vi.fn(() => [element]),
      addEventListener: vi.fn(),
    } as unknown as Document;
    const MutationObserver = class {
      constructor() {}
      observe = vi.fn();
    } as unknown as typeof globalThis.MutationObserver;
    const send = vi.fn();

    installProjectVisualSemanticKeyObserver({ send }, { document, MutationObserver, devicePixelRatio: 2, stableLayoutEpoch: () => 1 });

    expect(send).toHaveBeenCalledWith(VISUAL_SEMANTIC_KEYS_CHANNEL, expect.objectContaining({
      keys: ['canvas.root'],
      observations: [expect.objectContaining({
        key: 'canvas.root', role: 'main', visible: true,
        boundsCss: { x: 10, y: 20, width: 200, height: 100 },
        boundsDevice: { x: 20, y: 40, width: 400, height: 200 },
        clippedPercent: 0,
      })],
    }));
  });
});
