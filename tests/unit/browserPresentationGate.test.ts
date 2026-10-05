import { expect, it } from 'vitest';
import { browserViewBounds, createBrowserPresentationGate } from '../../src/main/backpacks/browserPresentationGate';
it('host hiding cannot be undone by a pane request, and showing cannot reopen a collapsed pane', () => {
  const gate = createBrowserPresentationGate();
  gate.setOwner('a', false); gate.setPane('a', true);
  expect(gate.allows('a')).toBe(false); expect(gate.allows('b')).toBe(true);
  gate.setPane('a', false); gate.setOwner('a', true); expect(gate.allows('a')).toBe(false);
  gate.setPane('a', true); expect(gate.allows('a')).toBe(true);
});
it('browser views are clipped within their exact owning surface', () => {
  expect(browserViewBounds({ x: 500, y: 50, width: 400, height: 600 }, { x: -30, y: 20, width: 800, height: 700 }))
    .toEqual({ x: 500, y: 70, width: 400, height: 580 });
});
