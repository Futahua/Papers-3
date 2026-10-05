import { describe, expect, it, vi } from 'vitest';
import { createBrowserVideoFullscreen } from '../../src/main/backpacks/browserVideoFullscreen';
function setup() {
  const events = new Map<string, Function>();
  const contents = { isDestroyed: () => false, focus: vi.fn(), executeJavaScript: vi.fn().mockResolvedValue(undefined), on: (name: string, fn: Function) => events.set(name, fn), once: (name: string, fn: Function) => events.set(name, fn) };
  const view = { webContents: contents, setBounds: vi.fn() };
  let ownerFullscreen = false;
  const ownerEvents = new Map<string, Function>();
  const owner = {
    isDestroyed: () => false,
    isFullScreen: () => ownerFullscreen,
    setFullScreen: vi.fn((next: boolean) => { ownerFullscreen = next; }),
    getContentBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    focus: vi.fn(),
    getBounds: () => ({ x: 2000, y: 50, width: 800, height: 600 }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    on: (name: string, fn: Function) => ownerEvents.set(name, fn),
    removeListener: (name: string, fn: Function) => {
      if (ownerEvents.get(name) === fn) ownerEvents.delete(name);
    },
  };
  const restore = vi.fn();
  const control = createBrowserVideoFullscreen(view as any, owner as any, restore);
  return {
    events, view, owner, ownerEvents, restore, control,
    setOwnerFullscreen(next: boolean) { ownerFullscreen = next; },
  };
}
describe('monitor video fullscreen lifecycle', () => {
  it('fills the fullscreen owner with the same live view and restores on exit', () => {
    const h = setup(); h.events.get('enter-html-full-screen')!();
    expect(h.owner.setFullScreen).toHaveBeenCalledWith(true);
    expect(h.owner.contentView.addChildView).toHaveBeenCalledWith(h.view);
    expect(h.owner.contentView.removeChildView).not.toHaveBeenCalled();
    expect(h.view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(h.control.isActive()).toBe(true);
    h.events.get('leave-html-full-screen')!();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.owner.setFullScreen).toHaveBeenLastCalledWith(false);
  });
  it('does not collapse Chromium owner fullscreen while the monitor view is entering', () => {
    const h = setup();
    // Electron/Chromium can fullscreen the current owner before delivering
    // enter-html-full-screen. Clearing it here immediately produces a matching
    // leave event and snaps the video back into the split browser pane.
    h.setOwnerFullscreen(true);
    h.events.get('enter-html-full-screen')!();
    expect(h.owner.setFullScreen).not.toHaveBeenCalled();
    expect(h.control.isActive()).toBe(true);
    h.events.get('leave-html-full-screen')!();
    expect(h.owner.setFullScreen).toHaveBeenCalledWith(false);
  });
  it('Escape exits fullscreen and restores once without closing the tab', () => {
    const h = setup(); h.events.get('enter-html-full-screen')!();
    h.events.get('before-input-event')!({}, { type: 'keyDown', key: 'Escape' });
    h.events.get('leave-html-full-screen')!();
    expect(h.restore).toHaveBeenCalledTimes(1); expect(h.control.isActive()).toBe(false);
    expect(h.view.webContents.executeJavaScript).toHaveBeenCalled();
  });
  it('tab destruction and explicit exit clean up idempotently', () => {
    const h = setup(); h.events.get('enter-html-full-screen')!();
    h.events.get('destroyed')!(); h.control.exit();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.ownerEvents.size).toBe(0);
  });
});
