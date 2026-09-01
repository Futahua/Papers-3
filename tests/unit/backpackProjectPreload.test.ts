import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: { invoke: mocks.invoke, send: mocks.send, on: mocks.on },
  webUtils: { getPathForFile: vi.fn() },
}));

describe('Backpack project protocol alignment', () => {
  let messageHandlers: Array<(event: { source: unknown; origin: string; data: unknown }) => void>;
  let posts: unknown[];

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.send.mockReset();
    mocks.on.mockReset();
    posts = [];
    messageHandlers = [];
    const listeners = new Map<string, (payload: unknown) => void>();
    globalThis.window = {
      location: { href: 'papers-backpack://bp-a/ns/1/public/index.html', origin: 'papers-backpack://bp-a' },
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        if (type === 'message') messageHandlers.push(callback as typeof messageHandlers[number]);
      },
      postMessage: (value: unknown) => { posts.push(value); },
    } as unknown as Window & typeof globalThis;
    mocks.on.mockImplementation((channel: string, callback: (event: unknown, payload?: unknown) => void) => {
      listeners.set(channel, (payload) => callback({}, payload));
    });
    vi.resetModules();
  });

  it('0A: a refused checked save travels as a delivered result, not a failed request', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));

    // The host refuses the save: its own `ok: false` must not overwrite the
    // transport envelope, or the project sees a broken host instead of a
    // conflict it can act on.
    mocks.invoke.mockResolvedValue({ ok: false, code: 'STALE_REVISION', revision: 'b'.repeat(64) });
    dispatch({
      type: 'papers:project:state-save-checked',
      requestId: 'save-1',
      state: '{"schemaVersion":1,"groups":[],"shortcuts":[]}',
      revision: 'a'.repeat(64),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.invoke).toHaveBeenCalledWith(
      'host:backpack-project:state-save-checked',
      '{"schemaVersion":1,"groups":[],"shortcuts":[]}',
      'a'.repeat(64),
    );
    expect(posts).toContainEqual({
      type: 'papers:host:result',
      requestId: 'save-1',
      ok: true,
      stateSave: { ok: false, code: 'STALE_REVISION', revision: 'b'.repeat(64) },
    });
  });

  it('0A: an accepted checked save arrives under the same wrapper', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    mocks.invoke.mockResolvedValue({ ok: true, revision: 'c'.repeat(64) });
    dispatch({
      type: 'papers:project:state-save-checked',
      requestId: 'save-2',
      state: '{"schemaVersion":1,"groups":[],"shortcuts":[]}',
      revision: 'a'.repeat(64),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(posts).toContainEqual({
      type: 'papers:host:result',
      requestId: 'save-2',
      ok: true,
      stateSave: { ok: true, revision: 'c'.repeat(64) },
    });
  });

  it('derives workspace identity and resolves one-way ACK requests immediately', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    mocks.invoke.mockResolvedValue({ ok: true });
    dispatch({
      type: 'papers:project:detach-open', requestId: 'open-1', bounds: null,
    });
    await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:detach-open', { projectId: 'bp-a', bounds: null });

    dispatch({
      type: 'papers:project:detach-stop-ack', requestId: 'ack-1', transferId: 'tr-1',
    });
    expect(mocks.send).toHaveBeenCalledWith('papers:backpack:detach-stop-ack', { transferId: 'tr-1' });
    expect(posts).toContainEqual({ type: 'papers:host:result', requestId: 'ack-1', ok: true });
    const sendsBeforeMalformed = mocks.send.mock.calls.length;
    dispatch({ type: 'papers:project:detach-stop-ack', requestId: 'ack-bad', transferId: '' });
    expect(mocks.send.mock.calls).toHaveLength(sendsBeforeMalformed);
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'ack-bad', ok: false }));
  });

  it('attaches stored detached token and transfer to argument-free reattach/focus', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    const tokenHandler = mocks.on.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1];
    expect(tokenHandler).toBeTypeOf('function');
    tokenHandler({}, { token: 'tok-1', transferId: 'tr-1' });
    expect(mocks.send).not.toHaveBeenCalledWith('papers:backpack:detach-ready', expect.anything());
    dispatch({ type: 'papers:project:detach-ready', requestId: 'ready-1' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith('papers:backpack:detach-ready', { token: 'tok-1', transferId: 'tr-1' });
    tokenHandler({}, { token: 'tok-1', transferId: 'tr-1' });
    dispatch({ type: 'papers:project:detach-ready', requestId: 'ready-2' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    dispatch({ type: 'papers:project:detach-ready', requestId: 'ready-bad', extra: true });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'ready-bad', ok: false }));
    expect(posts).not.toContainEqual(expect.objectContaining({ type: 'papers:project:detach-token' }));
    dispatch({ type: 'papers:project:detach-activated-ack', requestId: 'activated-bad', transferId: 'tr-other' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'activated-bad', ok: false }));
    dispatch({ type: 'papers:project:detach-activated-ack', requestId: 'activated-1', transferId: 'tr-1' });
    expect(mocks.send).toHaveBeenCalledWith('papers:backpack:detach-activated', { token: 'tok-1', transferId: 'tr-1' });
    dispatch({ type: 'papers:project:detach-activated-ack', requestId: 'activated-malformed', transferId: 'tr-1', extra: true });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'activated-malformed', ok: false }));
    dispatch({ type: 'papers:project:detach-activated-ack', requestId: 7, transferId: 'tr-1' });
    dispatch({ type: 'papers:project:detach-activated-ack', transferId: 'tr-1' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    mocks.invoke.mockResolvedValue({ ok: true });
    dispatch({
      type: 'papers:project:detach-reattach', requestId: 'r-1',
    });
    dispatch({
      type: 'papers:project:detach-focus', requestId: 'f-1',
    });
    await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:detach-reattach', { token: 'tok-1', transferId: 'tr-1' });
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:detach-focus', { token: 'tok-1', transferId: 'tr-1' });
  });

  it('018V2: page-ready before token latches and sends one hidden-token READY', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    const tokenHandler = mocks.on.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1];
    dispatch({ type: 'papers:project:detach-ready', requestId: 'ready-first' });
    expect(mocks.send).not.toHaveBeenCalled();
    tokenHandler({}, { token: 'tok-2', transferId: 'tr-2' });
    expect(mocks.send).toHaveBeenCalledWith('papers:backpack:detach-ready', { token: 'tok-2', transferId: 'tr-2' });
    expect(posts).toContainEqual({ type: 'papers:host:result', requestId: 'ready-first', ok: true });
  });

  it('019B: compact widget page/token readiness converges once without exposing its token', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    const tokenHandler = mocks.on.mock.calls.find(([channel]) => channel === 'papers:backpack:widget-token')?.[1];
    expect(tokenHandler).toBeTypeOf('function');
    dispatch({ type: 'papers:project:widget-ready', requestId: 'widget-ready-first' });
    expect(mocks.send).not.toHaveBeenCalled();
    tokenHandler({}, { token: 'widget-token' });
    expect(mocks.send).toHaveBeenCalledWith('papers:backpack:widget-ready', { token: 'widget-token' });
    tokenHandler({}, { token: 'widget-token' });
    dispatch({ type: 'papers:project:widget-ready', requestId: 'widget-ready-second' });
    dispatch({ type: 'papers:project:widget-ready', requestId: 'widget-ready-bad', extra: true });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(posts).not.toContainEqual(expect.objectContaining({ token: 'widget-token' }));
    expect(posts).toContainEqual({ type: 'papers:host:result', requestId: 'widget-ready-first', ok: true });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'widget-ready-bad', ok: false }));
  });

  it('routes only bounded widget drag coordinates with the hidden widget token', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    const tokenHandler = mocks.on.mock.calls.find(([channel]) => channel === 'papers:backpack:widget-token')?.[1];
    tokenHandler({}, { token: 'widget-token' });
    dispatch({ type: 'papers:project:widget-drag', phase: 'begin', x: 120, y: -40 });
    expect(mocks.send).toHaveBeenCalledWith('papers:backpack:widget-drag', {
      token: 'widget-token', phase: 'begin', x: 120, y: -40,
    });
    const before = mocks.send.mock.calls.length;
    dispatch({ type: 'papers:project:widget-drag', phase: 'move', x: Number.NaN, y: 0 });
    expect(mocks.send.mock.calls).toHaveLength(before);
  });

  it('019C: workspace widget-open/focus/close attach projectId and keep keys bounded', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    mocks.invoke.mockResolvedValue({ ok: true, reused: false });
    dispatch({ type: 'papers:project:widget-open', requestId: 'wo-1', layoutKey: 'layout-a' });
    dispatch({ type: 'papers:project:widget-focus', requestId: 'wf-1', layoutKey: 'layout-a' });
    dispatch({ type: 'papers:project:widget-close', requestId: 'wc-1', layoutKey: 'layout-a' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:widget-open', { projectId: 'bp-a', layoutKey: 'layout-a' });
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:widget-focus', { projectId: 'bp-a', layoutKey: 'layout-a' });
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:widget-close', { projectId: 'bp-a', layoutKey: 'layout-a' });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'wo-1', ok: true, widget: { ok: true, reused: false } }));
    expect(posts).not.toContainEqual(expect.objectContaining({ layoutKey: 'layout-a' }));
  });

  it('019C: malformed widget open/focus and an over-bounded key are rejected', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    dispatch({ type: 'papers:project:widget-open', requestId: 'wo-bad', layoutKey: 'x'.repeat(513) });
    dispatch({ type: 'papers:project:widget-open', requestId: 'wo-bad2' });
    dispatch({ type: 'papers:project:widget-open', requestId: 'wo-bad3', layoutKey: 7 });
    dispatch({ type: 'papers:project:widget-focus', requestId: 'wf-bad', layoutKey: 'x'.repeat(513) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).not.toHaveBeenCalled();
    for (const id of ['wo-bad', 'wo-bad2', 'wo-bad3', 'wf-bad']) {
      expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: id, ok: false }));
    }
  });

  it('019C: widget self-close stays token-attached with no page-visible token', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    const tokenHandler = mocks.on.mock.calls.find(([channel]) => channel === 'papers:backpack:widget-token')?.[1];
    mocks.invoke.mockResolvedValue({ ok: true });
    // No token latched yet: a bare widget-close is malformed.
    dispatch({ type: 'papers:project:widget-close', requestId: 'wc-no-token' });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'wc-no-token', ok: false }));
    tokenHandler({}, { token: 'widget-token' });
    dispatch({ type: 'papers:project:widget-close', requestId: 'wc-self' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:widget-close', { token: 'widget-token' });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'wc-self', ok: true }));
    expect(posts).not.toContainEqual(expect.objectContaining({ token: 'widget-token' }));
  });

  it('019G: window-thumbnail-capability forwards exact keys and rejects malformed shapes', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    mocks.invoke.mockResolvedValue({ outcome: 'success', imageUrl: 'data:image/png;base64,x', width: 240, height: 135 });
    const capability = { version: 1, bindingId: 'wl-binding-1' };
    dispatch({
      type: 'papers:project:window-thumbnail',
      requestId: 'thumb-1',
      capability,
      options: { maxWidth: 240, maxHeight: 135 },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).toHaveBeenCalledWith('papers:window-capability:thumbnail', { capability, options: { maxWidth: 240, maxHeight: 135 } });
    expect(posts).toContainEqual(expect.objectContaining({
      type: 'papers:host:result',
      requestId: 'thumb-1',
      ok: true,
      outcome: 'success',
      imageUrl: 'data:image/png;base64,x',
      width: 240,
      height: 135,
    }));
    // Malformed shapes are rejected with ok:false and never reach Papers.
    dispatch({ type: 'papers:project:window-thumbnail', requestId: 'thumb-bad-1', capability, options: { maxWidth: 240, maxHeight: 135, zoom: 2 } });
    dispatch({ type: 'papers:project:window-thumbnail', requestId: 'thumb-bad-2', capability, options: { maxWidth: 321, maxHeight: 135 } });
    dispatch({ type: 'papers:project:window-thumbnail', requestId: 'thumb-bad-3', capability, options: { maxWidth: 240.5, maxHeight: 135 } });
    dispatch({ type: 'papers:project:window-thumbnail', requestId: 'thumb-bad-4', capability, options: { maxWidth: '240', maxHeight: 135 } });
    dispatch({ type: 'papers:project:window-thumbnail', requestId: 'thumb-bad-5', capability: { version: 1, bindingId: 7 }, options: { maxWidth: 240, maxHeight: 135 } });
    dispatch({ type: 'papers:project:window-thumbnail', requestId: 'thumb-bad-6', capability, options: { maxWidth: 240, maxHeight: 135 }, extra: true });
    await new Promise((resolve) => setImmediate(resolve));
    for (const id of ['thumb-bad-1', 'thumb-bad-2', 'thumb-bad-3', 'thumb-bad-4', 'thumb-bad-5', 'thumb-bad-6']) {
      expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: id, ok: false }));
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('021: window-pick-stage and window-pick-commit forward empty payloads and reject malformed shapes', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    mocks.invoke.mockResolvedValue({ outcome: 'staged' });
    dispatch({ type: 'papers:project:window-pick-stage', requestId: 'stage-1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).toHaveBeenCalledWith('papers:window-pick:stage', {});
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'stage-1', ok: true }));

    mocks.invoke.mockResolvedValue({ outcome: 'committed' });
    dispatch({ type: 'papers:project:window-pick-commit', requestId: 'commit-1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).toHaveBeenCalledWith('papers:window-pick:commit', {});
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'commit-1', ok: true }));

    // Malformed shapes (extra keys) are rejected and never reach Papers.
    expect(() => dispatch({ type: 'papers:project:window-pick-stage', requestId: 'stage-bad', extra: true })).toThrow();
    expect(() => dispatch({ type: 'papers:project:window-pick-commit', requestId: 'commit-bad', extra: true })).toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('024: widget-report-size forwards the latched token and bounded size, and rejects malformed reports', async () => {
    await import('../../src/preload/backpackProject');
    const dispatch = (data: unknown) => messageHandlers.forEach((handler) => handler({ source: window, origin: window.location.origin, data }));
    const tokenHandler = mocks.on.mock.calls.find(([channel]) => channel === 'papers:backpack:widget-token')?.[1];
    mocks.invoke.mockResolvedValue({ ok: true });
    // No token latched: the size report is malformed.
    dispatch({ type: 'papers:project:widget-report-size', requestId: 'size-no-token', width: 360, height: 220 });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'size-no-token', ok: false }));
    expect(mocks.invoke).not.toHaveBeenCalled();

    tokenHandler({}, { token: 'widget-token' });
    dispatch({ type: 'papers:project:widget-report-size', requestId: 'size-1', width: 360, height: 220 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.invoke).toHaveBeenCalledWith('papers:backpack:widget-report-size', { token: 'widget-token', width: 360, height: 220 });
    expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: 'size-1', ok: true }));
    expect(posts).not.toContainEqual(expect.objectContaining({ token: 'widget-token' }));

    // Malformed sizes and extra keys are rejected.
    dispatch({ type: 'papers:project:widget-report-size', requestId: 'size-bad-1', width: 360 });
    dispatch({ type: 'papers:project:widget-report-size', requestId: 'size-bad-2', width: 360, height: 220, extra: true });
    dispatch({ type: 'papers:project:widget-report-size', requestId: 'size-bad-3', width: Number.NaN, height: 220 });
    dispatch({ type: 'papers:project:widget-report-size', requestId: 'size-bad-4', width: 4000, height: 220 });
    await new Promise((resolve) => setImmediate(resolve));
    for (const id of ['size-bad-1', 'size-bad-2', 'size-bad-3', 'size-bad-4']) {
      expect(posts).toContainEqual(expect.objectContaining({ type: 'papers:host:result', requestId: id, ok: false }));
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
