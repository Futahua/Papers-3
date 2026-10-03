import { describe, expect, it, vi } from 'vitest';

import { installProjectVisualLayoutObserver } from '../../src/preload/projectVisualLayoutObserver';
import { VISUAL_RENDERER_SIGNAL_CHANNEL } from '../../src/preload/projectVisualDiagnostics';

function setupObserver() {
  let geometryWidth = 100;
  let bodyAvailable = true;
  let bodyChildElementCount = 1;
  const frames: FrameRequestCallback[] = [];
  let mutationCallback: (() => void) | undefined;
  const rect = () => ({ x: 0, y: 0, width: geometryWidth, height: 80 });
  const body = { get childElementCount() { return bodyChildElementCount; }, getBoundingClientRect: rect, scrollWidth: 100, scrollHeight: 80 };
  const root = { getBoundingClientRect: rect, scrollWidth: 100, scrollHeight: 80 };
  const document = { documentElement: root, get body() { return bodyAvailable ? body : null; } } as unknown as Document;
  class FakeResizeObserver {
    observe(): void {}
  }
  class FakeMutationObserver {
    constructor(callback: () => void) { mutationCallback = callback; }
    observe(): void {}
  }
  const send = vi.fn();
  installProjectVisualLayoutObserver({ send }, {
    document,
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
    MutationObserver: FakeMutationObserver as unknown as typeof MutationObserver,
  });
  return {
    send,
    setWidth: (width: number) => { geometryWidth = width; },
    setBodyAvailable: (available: boolean) => { bodyAvailable = available; },
    setBodyChildElementCount: (count: number) => { bodyChildElementCount = count; },
    mutate: () => mutationCallback?.(),
    flushFrame: () => frames.shift()?.(0),
  };
}

describe('project visual layout observer', () => {
  it('emits once after three unchanged animation frames', () => {
    const observer = setupObserver();

    observer.flushFrame();
    observer.flushFrame();
    observer.flushFrame();

    expect(observer.send).toHaveBeenCalledTimes(2);
    expect(observer.send).toHaveBeenNthCalledWith(1, VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'layout-epoch', epoch: 1,
    });
    expect(observer.send).toHaveBeenNthCalledWith(2, VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'layout-stable', epoch: 1,
    });
  });

  it('treats an empty body as a measurable layout', () => {
    const observer = setupObserver();

    observer.setBodyChildElementCount(0);
    observer.flushFrame();
    observer.flushFrame();
    observer.flushFrame();

    expect(observer.send).toHaveBeenCalledWith(VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'layout-stable', epoch: 1,
    });
  });

  it('treats a text-only body as a measurable layout', () => {
    const observer = setupObserver();

    observer.flushFrame();
    observer.flushFrame();
    observer.flushFrame();

    expect(observer.send).toHaveBeenCalledWith(VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'layout-stable', epoch: 1,
    });
  });

  it('bounds an epoch even when geometry becomes temporarily unavailable', () => {
    const observer = setupObserver();
    observer.flushFrame();
    observer.setBodyAvailable(false);
    for (let frame = 1; frame < 12; frame += 1) observer.flushFrame();

    expect(observer.send).toHaveBeenCalledWith(VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'render-failed', detail: 'layout-stability-timeout',
    });
  });

  it('starts a fresh bounded epoch after a later mutation', () => {
    const observer = setupObserver();
    observer.flushFrame();
    observer.flushFrame();
    observer.flushFrame();

    observer.setWidth(120);
    observer.mutate();
    observer.flushFrame();
    observer.flushFrame();
    observer.flushFrame();

    expect(observer.send).toHaveBeenCalledTimes(4);
  });

  it('reports timeout instead of waiting forever when geometry keeps changing', () => {
    const observer = setupObserver();
    for (let frame = 0; frame < 12; frame += 1) {
      observer.setWidth(100 + frame);
      observer.flushFrame();
    }

    expect(observer.send).toHaveBeenCalledWith(VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'render-failed', detail: 'layout-stability-timeout',
    });
  });
});
