import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toolbarPositionFromRect,
  createToolbarController,
} from './public/app/components/toolbar-controller.js';

const workspaceRect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };

test('toolbarPositionFromRect anchors to the nearer edge as a fraction', () => {
  // Near the left edge -> positive x fraction of width.
  const left = toolbarPositionFromRect({ left: 20, right: 120, top: 30, bottom: 80 }, workspaceRect);
  assert.ok(Math.abs(left.x - 20 / 1000) < 1e-9);
  assert.ok(Math.abs(left.y - 30 / 800) < 1e-9);

  // Near the right edge -> negative x fraction (distance from right edge).
  const right = toolbarPositionFromRect({ left: 880, right: 980, top: 30, bottom: 80 }, workspaceRect);
  assert.ok(Math.abs(right.x - (-20 / 1000)) < 1e-9);

  // Near the bottom edge -> negative y fraction.
  const bottom = toolbarPositionFromRect({ left: 20, right: 120, top: 720, bottom: 790 }, workspaceRect);
  assert.ok(Math.abs(bottom.y - (-10 / 800)) < 1e-9);
});

test('toolbarPositionFromRect stays finite on degenerate empty rects', () => {
  const result = toolbarPositionFromRect({ left: 0, right: 0, top: 0, bottom: 0 }, workspaceRect);
  assert.ok(Number.isFinite(result.x));
  assert.ok(Number.isFinite(result.y));
});

/** Builds a mock window/document/element environment plus a ready controller,
 * recording state writes, persists, and listener lifecycle. */
function createHarness(savedPositions = {}) {
  const stateWrites = [];
  const persists = [];
  const statuses = [];
  const windowListeners = [];
  const elements = [];

  const workspaceEl = {
    getBoundingClientRect: () => workspaceRect,
    offsetWidth: 1000,
    offsetHeight: 800,
  };

  const windowMock = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      windowListeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = windowListeners.indexOf(entry);
          if (index >= 0) windowListeners.splice(index, 1);
        });
      }
    },
  };

  const documentMock = {
    querySelectorAll(selector) {
      return selector === '.toolbar-float[data-toolbar-key]' ? elements : [];
    },
    querySelector(selector) {
      return selector === '.workspace' ? workspaceEl : null;
    },
  };

  function makeElement(key) {
    const elementListeners = [];
    const classSet = new Set();
    const handle = {
      closest(selector) {
        return selector === '[data-toolbar-drag-handle]' ? handle : null;
      },
    };
    const element = {
      dataset: { toolbarKey: key },
      style: {},
      offsetWidth: 100,
      offsetHeight: 60,
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture() { return false; },
      closest() { return null; },
      classList: {
        add: (name) => classSet.add(name),
        remove: (name) => classSet.delete(name),
        contains: (name) => classSet.has(name),
      },
      addEventListener(type, handler, options) {
        const entry = { type, handler, options };
        elementListeners.push(entry);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const index = elementListeners.indexOf(entry);
            if (index >= 0) elementListeners.splice(index, 1);
          });
        }
      },
      _listeners: elementListeners,
      _handle: handle,
      _dispatch(type, event) {
        for (const entry of [...elementListeners]) {
          if (entry.type === type) entry.handler(event);
        }
      },
    };
    // getBoundingClientRect reflects the inline left/top the controller sets,
    // so a drag actually moves the element in the harness.
    element.getBoundingClientRect = () => {
      const left = element.style.left?.endsWith('px')
        ? Number.parseFloat(element.style.left)
        : 100;
      const top = element.style.top?.endsWith('px')
        ? Number.parseFloat(element.style.top)
        : 100;
      return { left, top, right: left + 100, bottom: top + 60, width: 100, height: 60 };
    };
    elements.push(element);
    return element;
  }

  let state = { view: { toolbarPositions: savedPositions } };
  const model = {
    getToolbarPosition(s, key) {
      return s.view?.toolbarPositions?.[key] ?? null;
    },
    setToolbarPosition(s, key, pos) {
      return {
        ...s,
        view: {
          ...s.view,
          toolbarPositions: { ...(s.view?.toolbarPositions ?? {}), [key]: pos },
        },
      };
    },
  };

  const controller = createToolbarController({
    window: windowMock,
    document: documentMock,
    getState: () => state,
    setState: (next) => { state = next; stateWrites.push(next); },
    setToolbarPosition: model.setToolbarPosition,
    getToolbarPosition: model.getToolbarPosition,
    persist: async (next) => { persists.push(next); },
    setStatus: (text) => statuses.push(text),
  });

  return {
    controller,
    makeElement,
    elements,
    workspaceEl,
    windowListeners,
    stateWrites,
    persists,
    statuses,
    getState: () => state,
    dispatchWindow(type, event) {
      for (const entry of [...windowListeners]) {
        if (entry.type === type) entry.handler(event);
      }
    },
  };
}

function pointerEvent(pointerId, x, y, element, target = element) {
  return {
    button: 0,
    pointerId,
    clientX: x,
    clientY: y,
    target,
    preventDefault() {},
    stopPropagation() {},
  };
}

/** Horizontal offsets are percentages; the vertical one is deliberately not.
 *
 * The pills live inside .navigation, which is height:0, so a percentage top or
 * bottom resolves against nothing and lands the element off-screen above the
 * window — that is how a pill dragged near the bottom edge became unreachable.
 * d0059e2 converted the vertical offset to pixels against the workspace height
 * to fix it. These assertions were written before that and went stale; the
 * workspace is 1000x800 here, so y 0.25 is 200px and y 0.1 is 80px.
 *
 * If a future change makes these percentages again, check that a pill dropped
 * near the bottom edge is still reachable before believing it.
 */
test('toolbar mount restores saved positions, horizontally in percent and vertically in pixels', () => {
  const h = createHarness({
    'bin-button': { x: 0.5, y: 0.25 },
    'delete-all-bin': { x: -0.2, y: 0.1 },
  });
  const bin = h.makeElement('bin-button');
  const del = h.makeElement('delete-all-bin');

  h.controller.mount();

  // x >= 0 anchors left as a percentage of workspace width.
  assert.equal(bin.style.left, '50%');
  assert.equal(bin.style.right, 'auto');
  assert.equal(bin.style.top, '200px');
  assert.equal(bin.style.bottom, 'auto');
  // x < 0 anchors right as a percentage of workspace width.
  assert.equal(del.style.right, '20%');
  assert.equal(del.style.left, 'auto');
  assert.equal(del.style.top, '80px');
  assert.equal(del.style.bottom, 'auto');
});

test('toolbar drag clamps within the workspace and persists the new position', async () => {
  const h = createHarness({});
  const el = h.makeElement('bin-button');
  h.controller.mount();

  el._dispatch('pointerdown', pointerEvent(1, 150, 150, el, el._handle));
  // Move well past the 4px threshold to a near-right-edge position.
  el._dispatch('pointermove', pointerEvent(1, 950, 150, el));
  el._dispatch('pointerup', pointerEvent(1, 950, 150, el));

  assert.equal(h.persists.length, 1);
  assert.equal(h.stateWrites.length, 1);
  // Dropped near the right edge -> stored as a negative fraction.
  const saved = h.getState().view.toolbarPositions['bin-button'];
  assert.ok(saved.x < 0, `expected negative right-edge offset, got ${saved.x}`);
  assert.ok(Math.abs(saved.x) <= 1);
});

test('toolbar drag below the threshold does not persist a position', () => {
  const h = createHarness({});
  const el = h.makeElement('bin-button');
  h.controller.mount();

  el._dispatch('pointerdown', pointerEvent(1, 150, 150, el, el._handle));
  el._dispatch('pointermove', pointerEvent(1, 152, 152, el, el._handle));
  el._dispatch('pointerup', pointerEvent(1, 152, 152, el, el._handle));

  assert.equal(h.persists.length, 0);
  assert.equal(h.stateWrites.length, 0);
});

test('toolbar action surfaces do not begin a drag without the explicit handle', () => {
  const h = createHarness({});
  const el = h.makeElement('bin-button');
  h.controller.mount();

  el._dispatch('pointerdown', pointerEvent(1, 150, 150, el));
  el._dispatch('pointermove', pointerEvent(1, 950, 150, el));
  el._dispatch('pointerup', pointerEvent(1, 950, 150, el));

  assert.equal(h.persists.length, 0);
  assert.equal(h.stateWrites.length, 0);
});

test('toolbar pointer cancellation restores the pre-drag position without persisting', () => {
  const h = createHarness({});
  const el = h.makeElement('bin-button');
  el.style.left = '25px';
  el.style.right = 'auto';
  el.style.top = '30px';
  el.style.bottom = 'auto';
  h.controller.mount();

  el._dispatch('pointerdown', pointerEvent(1, 150, 150, el, el._handle));
  el._dispatch('pointermove', pointerEvent(1, 400, 350, el, el._handle));
  assert.notEqual(el.style.left, '25px');
  el._dispatch('pointercancel', pointerEvent(1, 400, 350, el, el._handle));

  assert.equal(el.style.left, '25px');
  assert.equal(el.style.right, 'auto');
  assert.equal(el.style.top, '30px');
  assert.equal(el.style.bottom, 'auto');
  assert.equal(h.persists.length, 0);
  assert.equal(h.stateWrites.length, 0);
});

test('a completed handle drag does not suppress the next real action click', () => {
  const h = createHarness({});
  const el = h.makeElement('bin-button');
  h.controller.mount();

  el._dispatch('pointerdown', pointerEvent(1, 150, 150, el, el._handle));
  el._dispatch('pointermove', pointerEvent(1, 300, 180, el, el._handle));
  el._dispatch('pointerup', pointerEvent(1, 300, 180, el, el._handle));
  let prevented = false;
  el._dispatch('click', {
    target: el,
    preventDefault() { prevented = true; },
    stopPropagation() {},
  });

  assert.equal(prevented, false);
  assert.equal(h.persists.length, 1);
});

test('a competing pointer cannot replace the active toolbar drag', () => {
  const h = createHarness({});
  const first = h.makeElement('bin-button');
  const second = h.makeElement('copy-prompt');
  h.controller.mount();

  first._dispatch('pointerdown', pointerEvent(1, 150, 150, first, first._handle));
  first._dispatch('pointermove', pointerEvent(1, 300, 180, first, first._handle));
  second._dispatch('pointerdown', pointerEvent(2, 450, 150, second, second._handle));
  second._dispatch('pointermove', pointerEvent(2, 700, 180, second, second._handle));
  first._dispatch('pointerup', pointerEvent(1, 300, 180, first, first._handle));

  assert.equal(h.persists.length, 1);
  assert.ok(h.getState().view.toolbarPositions['bin-button']);
  assert.equal(h.getState().view.toolbarPositions['copy-prompt'], undefined);
});

test('blur and destroy roll back an active toolbar drag without persistence', () => {
  const h = createHarness({});
  const el = h.makeElement('bin-button');
  el.style.left = '25px';
  el.style.top = '30px';
  h.controller.mount();

  el._dispatch('pointerdown', pointerEvent(1, 150, 150, el, el._handle));
  el._dispatch('pointermove', pointerEvent(1, 400, 350, el, el._handle));
  h.dispatchWindow('blur', {});
  assert.equal(el.style.left, '25px');
  assert.equal(el.style.top, '30px');

  el._dispatch('pointerdown', pointerEvent(2, 150, 150, el, el._handle));
  el._dispatch('pointermove', pointerEvent(2, 400, 350, el, el._handle));
  h.controller.destroy();
  assert.equal(el.style.left, '25px');
  assert.equal(el.style.top, '30px');
  assert.equal(h.persists.length, 0);
});

test('toolbar resize re-applies saved positions after the debounce', async () => {
  const h = createHarness({ 'bin-button': { x: 0.5, y: 0.25 } });
  const el = h.makeElement('bin-button');
  h.controller.mount();

  // Clear the mounted position so the resize handler has work to redo.
  el.style.left = 'auto';
  el.style.top = 'auto';
  h.dispatchWindow('resize', {});
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(el.style.left, '50%');
  // Pixels, not percent, for the reason given on the mount test above.
  assert.equal(el.style.top, '200px');
});

test('toolbar destroy removes listeners and clears a pending resize timer', async () => {
  const h = createHarness({ 'bin-button': { x: 0.5, y: 0.25 } });
  const el = h.makeElement('bin-button');
  h.controller.mount();

  const windowListenerCount = h.windowListeners.length;
  const elementListenerCount = el._listeners.length;
  assert.ok(windowListenerCount > 0);
  assert.ok(elementListenerCount > 0);

  h.controller.destroy();

  // AbortController signal removal drops the registered listeners.
  assert.equal(h.windowListeners.length, 0);
  assert.equal(el._listeners.length, 0);

  // A resize fired after destroy schedules nothing that would write state.
  h.dispatchWindow('resize', {});
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(h.stateWrites.length, 0);
});
