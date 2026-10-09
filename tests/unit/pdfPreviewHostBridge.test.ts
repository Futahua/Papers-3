import { beforeEach, expect, it, vi } from 'vitest';
import type { BaseWindow } from 'electron';
import { createPdfPreviewHostBridge } from '../../src/main/backpacks/pdfPreviewHostBridge';

const { views } = vi.hoisted(() => ({ views: [] as any[] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { WebContentsView: class {
    bounds: unknown;
    closed = false;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { frames: [] },
      isDestroyed: () => this.closed,
      loadURL: vi.fn(async () => {}),
      close: () => { this.closed = true; this.webContents.emit('destroyed'); },
    });
    constructor() { views.push(this); }
    setBounds(bounds: unknown) { this.bounds = bounds; }
  } };
});

beforeEach(() => { views.length = 0; });
function fixture() {
  const visible = new Set<unknown>();
  const window = { id: 9, isDestroyed: () => false, contentView: {
    addChildView: (view: unknown) => visible.add(view), removeChildView: (view: unknown) => visible.delete(view),
  } } as unknown as BaseWindow;
  const bridge = createPdfPreviewHostBridge({ resolveWindow: () => window, stateDirectory: 'unused-without-state-key' });
  const context = { ownerKey: 'backpack-a', parentHwnd: '1', surfaceBounds: { x: 40, y: 70, width: 800, height: 600 } };
  const rect = { x: 10, y: 20, width: 300, height: 400 };
  const open = (surfaceId?: string) => bridge.open(context, 'papers-file-preview://backpack-a/resource/test.pdf', rect, vi.fn(), null, surfaceId);
  return { bridge, visible, context, rect, open };
}

it('pinned PDF surfaces coexist with the ordinary preview; replacement and session authority stay local', async () => {
  const f = fixture();
  const ordinary = await f.open(), first = await f.open('pane:first'), second = await f.open('pane:second');
  expect([ordinary.ok, first.ok, second.ok]).toEqual([true, true, true]);
  expect(f.visible.size).toBe(3);
  expect(views.every(v => !v.closed)).toBe(true);
  await f.open('pane:first');
  expect(views.map(v => v.closed)).toEqual([false, true, false, false]);
  expect(f.visible.size).toBe(3);
  if (!second.ok) throw Error('Second PDF did not open');
  expect(f.bridge.move('backpack-b', second.sessionId, f.rect)).toBe(false);
  expect(await f.bridge.close('backpack-b', second.sessionId)).toBe(false);
  expect(await f.bridge.close(f.context.ownerKey, second.sessionId)).toBe(true);
  expect(views[2].closed).toBe(true);
  expect(f.visible.size).toBe(2);
  f.bridge.dispose();
});

it('owner movement, suspension, restoration and teardown include every pinned PDF surface', async () => {
  const f = fixture();
  await f.open('pane:first'); await f.open('pane:second');
  f.bridge.setOwnerSurfaceBounds(f.context.ownerKey, { x: 100, y: 200, width: 800, height: 600 });
  expect(views.map(v => v.bounds)).toEqual([f.rect, f.rect].map(r => ({ ...r, x: 110, y: 220 })));
  f.bridge.setOwnerVisible(f.context.ownerKey, false);
  expect(f.visible.size).toBe(0);
  expect(views.every(v => !v.closed)).toBe(true);
  f.bridge.setOwnerVisible(f.context.ownerKey, true);
  expect(f.visible.size).toBe(2);
  f.bridge.closeOwner(f.context.ownerKey);
  expect(f.visible.size).toBe(0);
  expect(views.every(v => v.closed)).toBe(true);
});

it('invalid PDF surface identities clean up the resource without opening a view', async () => {
  const f = fixture(), cleanup = vi.fn();
  for (const surface of ['', 'x'.repeat(129)]) {
    expect((await f.bridge.open(f.context, 'papers-file-preview://backpack-a/resource/test.pdf', f.rect, cleanup, null, surface)).ok).toBe(false);
  }
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(views).toHaveLength(0);
});
