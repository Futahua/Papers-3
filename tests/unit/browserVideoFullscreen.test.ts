import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserVideoFullscreen } from '../../src/main/backpacks/browserVideoFullscreen';
const state = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({ bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }) }, BaseWindow: class {
  destroyed = false; handlers = new Map();
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
  setFullScreen = vi.fn(); show = vi.fn(); focus = vi.fn();
  constructor(public options: unknown) { state.windows.push(this); }
  isDestroyed() { return this.destroyed; }
  getContentBounds() { return { width: 1920, height: 1080 }; }
  on(event: string, callback: Function) { this.handlers.set(event, callback); }
  close() { this.handlers.get('close')?.(); this.destroyed = true; }
} }));
beforeEach(() => { state.windows.length = 0; });
function setup() {
  const events = new Map<string, Function>();
  const contents = { isDestroyed: () => false, focus: vi.fn(), executeJavaScript: vi.fn().mockResolvedValue(undefined), on: (name: string, fn: Function) => events.set(name, fn), once: (name: string, fn: Function) => events.set(name, fn) };
  const view = { webContents: contents, setBounds: vi.fn() };
  const owner = { isDestroyed: () => false, isFullScreen: () => false, setFullScreen: vi.fn(), getBounds: () => ({ x: 2000, y: 50, width: 800, height: 600 }), contentView: { removeChildView: vi.fn() } };
  const restore = vi.fn();
  const control = createBrowserVideoFullscreen(view as any, owner as any, restore);
  return { events, view, owner, restore, control };
}
describe('monitor video fullscreen lifecycle', () => {
  it('moves the same live view to the owner monitor and restores on exit', () => {
    const h = setup(); h.events.get('enter-html-full-screen')!();
    const window = state.windows[0];
    expect(window.options).toMatchObject({ x: 1920, width: 1920, height: 1080 });
    expect(window.contentView.addChildView).toHaveBeenCalledWith(h.view);
    expect(h.view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(h.control.isActive()).toBe(true);
    h.events.get('leave-html-full-screen')!();
    expect(h.restore).toHaveBeenCalledTimes(1); expect(window.destroyed).toBe(true);
  });
  it('Escape exits fullscreen and restores once without closing the tab', () => {
    const h = setup(); h.events.get('enter-html-full-screen')!();
    h.events.get('before-input-event')!({}, { type: 'keyDown', key: 'Escape' });
    h.events.get('leave-html-full-screen')!();
    expect(h.restore).toHaveBeenCalledTimes(1); expect(h.control.isActive()).toBe(false);
    expect(h.view.webContents.executeJavaScript).toHaveBeenCalled();
  });
  it('closing the monitor window and tab destruction clean up idempotently', () => {
    const h = setup(); h.events.get('enter-html-full-screen')!();
    state.windows[0].close(); h.events.get('destroyed')!(); h.control.exit();
    expect(h.restore).toHaveBeenCalledTimes(1);
  });
});
