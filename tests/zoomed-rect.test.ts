import { expect, it } from 'vitest';

import { zoomedRect } from '../src/main/zoomedRect';

it('a zoomed page has its overlay rectangle turned into window pixels', () => {
  const request = { operation: 'windows-preview-move', params: { sessionId: 's', rect: { x: 423, y: 80, width: 455, height: 650, extra: 'kept' } } };
  const scaled = zoomedRect(request, 1.12) as typeof request;
  expect(scaled.params.rect).toEqual({ x: 423 * 1.12, y: 80 * 1.12, width: 455 * 1.12, height: 650 * 1.12, extra: 'kept' });
  expect(scaled.params.sessionId).toBe('s');
  expect(request.params.rect.x).toBe(423);
});
it('unzoomed pages and requests without a rectangle pass through untouched', () => {
  const request = { operation: 'list', params: { path: 'C:/' } };
  expect(zoomedRect(request, 1.12)).toBe(request);
  const moved = { operation: 'html-preview-move', params: { rect: { x: 1, y: 2, width: 3, height: 4 } } };
  expect(zoomedRect(moved, 1)).toBe(moved);
  expect(zoomedRect(moved, Number.NaN)).toBe(moved);
});
