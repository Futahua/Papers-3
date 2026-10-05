import { expect, it, vi } from 'vitest';
import { installChromeFocusPolicy } from '../../src/host/chromeFocusPolicy';
it('keeps shell controls out of Tab order across dynamic menus and focus-index changes', () => {
  const button = { tabIndex: 0 }; const input = { tabIndex: 0 }; const controls = [button];
  let update!: () => void;
  const observe = vi.fn(); const disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { update = callback; }
    observe = observe; disconnect = disconnect;
  });
  try {
    const root = { body: {}, querySelectorAll: vi.fn(() => controls) };
    const stop = installChromeFocusPolicy(root as unknown as Document);
    expect(button.tabIndex).toBe(-1); expect(input.tabIndex).toBe(0);
    const dynamic = { tabIndex: 0 }; controls.push(dynamic); update();
    expect(dynamic.tabIndex).toBe(-1);
    button.tabIndex = 0; update(); expect(button.tabIndex).toBe(-1);
    expect(observe).toHaveBeenCalledWith(root.body, expect.objectContaining({ attributeFilter: ['tabindex', 'role'] }));
    stop(); expect(disconnect).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
