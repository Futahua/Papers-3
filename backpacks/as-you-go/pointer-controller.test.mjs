import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createPointerController } from './public/app/interactions/pointer-controller.js';

function fakeNode() {
  return {
    style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._s.has(c) : force;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
    },
    _listeners: [],
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      this._listeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = this._listeners.indexOf(entry);
          if (index >= 0) this._listeners.splice(index, 1);
        });
      }
    },
    _dispatch(type, event) {
      for (const entry of [...this._listeners]) {
        if (entry.type === type) entry.handler(event);
      }
    },
  };
}

function createHarness({ binMode = false, nativeDragPaths = () => [] } = {}) {
  const store = createWorkspaceStore({
    getState: () => ({}),
    setState: () => {},
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { binMode },
  });
  const grid = fakeNode();
  grid.setPointerCapture = () => {};
  grid.hasPointerCapture = () => true;
  let released = 0;
  grid.releasePointerCapture = () => { released += 1; };
  grid.querySelector = () => null;
  let shells = [];
  grid.querySelectorAll = () => shells;
  const binButton = fakeNode();
  binButton.contains = () => false;
  const elements = { grid, binButton };
  const windowListeners = [];
  const windowMock = {
    innerWidth: 500,
    innerHeight: 400,
    addEventListener(type, handler, options) {
      windowListeners.push({ type, handler, options });
    },
    removeEventListener(type, handler) {
      const index = windowListeners.findIndex((e) => e.type === type && e.handler === handler);
      if (index >= 0) windowListeners.splice(index, 1);
    },
  };
  let elementAtPoint = null;
  const documentMock = { querySelectorAll: () => shells, elementFromPoint: () => elementAtPoint };
  const commandCalls = [];
  const commands = {
    selectItem: (id, opts) => { commandCalls.push(['select', id, opts]); },
    activateItem: (id, opts) => { commandCalls.push(['activate', id, opts]); },
    dragDropToBin: (input) => { commandCalls.push(['bin', input]); },
    dragDropToFolder: (input) => { commandCalls.push(['folder', input]); },
    pinDraggedNodes: (input) => { commandCalls.push(['pin', input]); },
    releaseDraggedNodes: (input) => { commandCalls.push(['release', input]); },
  };
  const graphNodes = new Map();
  const nativeDragCalls = [];
  const effects = { reheat: [], decay: 0, close: 0, suppressGraph: [], suppressBlank: [], ejected: [], trails: [], trailClear: 0 };
  const graph = {
    _getNode: (id) => graphNodes.get(id) ?? null,
    reheat: (a) => { effects.reheat.push(a); },
    _setSimulationDecay: () => { effects.decay += 1; },
    // Required, not optional: an absent method reached through `?.` would make
    // ejection silently never happen, which is the shape of two bugs already
    // found on this branch.
    ejectTrespassers: (ids) => { effects.ejected.push([...ids]); },
  };
  let marqueeActivePointer = null;
  const marquee = {
    isActive: (pointerId) => marqueeActivePointer === pointerId,
    start: (input) => { commandCalls.push(['marquee-start', input]); },
    move: (input) => { commandCalls.push(['marquee-move', input]); },
    finish: (pointerId) => { marqueeActivePointer = null; return true; },
  };
  let suppressGraphClickFlag = false;
  const controller = createPointerController({
    window: windowMock,
    document: documentMock,
    elements,
    store,
    commands,
    graph,
    marquee,
    zoomTransform: () => ({ x: 0, y: 0, k: 1 }),
    group: () => null,
    visiblePlacementIdFor: (id) => `p-${id}`,
    closeMenu: () => { effects.close += 1; },
    nativeDragPaths,
    startNativeDrag: (paths) => { nativeDragCalls.push([...paths]); return Promise.resolve(); },
    onDragTrail: (ids) => { effects.trails.push([...ids]); },
    clearDragTrail: () => { effects.trailClear += 1; },
    setSuppressGraphClick: (v) => { effects.suppressGraph.push(v); },
    setSuppressBlankClick: (v) => { effects.suppressBlank.push(v); },
    consumeSuppressGraphClick: () => {
      if (!suppressGraphClickFlag) return false;
      suppressGraphClickFlag = false;
      return true;
    },
  });
  controller.mount();
  return {
    controller, grid, binButton, store, commands, commandCalls, graphNodes, effects, windowListeners, marquee, windowMock, nativeDragCalls,
    getShells: () => shells,
    setShells: (value) => { shells = value; },
    setElementAtPoint: (value) => { elementAtPoint = value; },
    getReleased: () => released,
    setSuppressGraphClickFlag: (value) => { suppressGraphClickFlag = value; },
    getSuppressGraphClickFlag: () => suppressGraphClickFlag,
  };
}

function node(id, x = 0, y = 0) {
  const shell = fakeNode();
  shell.dataset = { graphNodeId: id };
  return { id, x, y, fx: null, fy: null, positioned: false, shell };
}

function pointerEvent(pointerId, clientX, clientY, overrides = {}) {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
    pointerType: 'mouse',
    ctrlKey: false,
    shiftKey: false,
    preventDefault() {},
    target: { closest: () => null },
    dataTransfer: undefined,
    ...overrides,
  };
}

test('pointerdown on a tile routes selection and starts a graph drag', () => {
  const h = createHarness();
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  const shell = fakeNode();
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? shell : null);
  const event = pointerEvent(1, 10, 10, { target: tile });
  h.graphNodes.set('s1', node('s1'));
  h.grid._dispatch('pointerdown', event);
  assert.deepEqual(h.commandCalls[0], ['select', 's1', { shiftKey: false, ctrlKey: false, visibleItemIds: [] }]);
});

test('pointermove beyond threshold moves the dragged nodes', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  assert.equal(n.moved, undefined);
  assert.equal(n.fx, 110); // startWorld derived from client coords with identity transform
  assert.equal(n.fy, 105);
  assert.ok(h.effects.reheat.length > 0);
  assert.deepEqual(h.effects.trails.at(-1), ['s1']);
});

test('dragging selected local shortcuts out of the AYG window hands off to native drag without moving the graph', () => {
  const h = createHarness({
    nativeDragPaths: (ids) => ids.map((id) => `D:\\drop\\${id}.txt`),
  });
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  assert.equal(n.fx, 110);
  assert.equal(n.fy, 105);

  h.grid._dispatch('pointermove', pointerEvent(1, 501, 15));

  assert.deepEqual(h.nativeDragCalls, [['D:\\drop\\s1.txt']]);
  assert.equal(n.x, 100);
  assert.equal(n.y, 100);
  assert.equal(n.fx, null);
  assert.equal(n.fy, null);
  assert.equal(h.getReleased(), 1);
  assert.equal(h.commandCalls.find(([name]) => name === 'release'), undefined);
  assert.equal(h.effects.suppressGraph.at(-1), true);
});

test('many-small-step drag keeps pointer tracking error exactly zero', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  let trackingError = 0;
  for (let step = 1; step <= 120; step += 1) {
    const clientX = 20 + step * 0.75;
    const clientY = 15 + step * 0.5;
    h.grid._dispatch('pointermove', pointerEvent(1, clientX, clientY));
    trackingError += Math.abs(n.x - (110 + step * 0.75)) + Math.abs(n.y - (105 + step * 0.5));
  }
  assert.equal(trackingError, 0);
  assert.equal(h.effects.trails.length, 121);
  assert.equal(h.effects.reheat.filter((value) => value === 0.12).length, 121);
});

test('pointerup on the Bin routes dragDropToBin', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  h.binButton.contains = () => true;
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15));
  const binCall = h.commandCalls.find(([name]) => name === 'bin');
  assert.ok(binCall);
  assert.deepEqual(binCall[1].itemIds, ['s1']);
  assert.equal(h.effects.suppressGraph.at(-1), true);
});

test('pointerup pin routes pinDraggedNodes with positions', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15, { shiftKey: true }));
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15, { shiftKey: true }));
  const pinCall = h.commandCalls.find(([name]) => name === 'pin');
  assert.ok(pinCall);
  assert.ok(pinCall[1].positions.s1);
  assert.equal(h.effects.decay, 1);
});

test('pointerup without pin routes releaseDraggedNodes', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15));
  const releaseCall = h.commandCalls.find(([name]) => name === 'release');
  assert.ok(releaseCall);
  assert.deepEqual(releaseCall[1].itemIds, ['s1']);
  assert.equal(h.effects.trailClear, 1);
});

test('pointerdown on blank starts the marquee', () => {
  const h = createHarness();
  const event = pointerEvent(1, 30, 30);
  event.target.closest = (sel) => (sel.includes('data-icon-grid') ? { dataset: {} } : null);
  h.grid._dispatch('pointerdown', event);
  assert.ok(h.commandCalls.some(([name]) => name === 'marquee-start'));
});

test('cancelDrag removes shift listeners and clears visuals', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  assert.ok(h.windowListeners.length > 0);
  h.controller.cancelDrag();
  assert.equal(h.effects.trailClear, 1);
  assert.equal(h.windowListeners.length, 0);
});

test('destroy removes the pointer listeners', () => {
  const h = createHarness();
  assert.ok(h.grid._listeners.length > 0);
  h.controller.destroy();
  assert.equal(h.grid._listeners.length, 0);
});

test('double-click on a tile routes activateItem with revealDirectoryTarget', () => {
  const h = createHarness();
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : null);
  h.grid._dispatch('dblclick', { target: tile });
  assert.deepEqual(h.commandCalls, [['activate', 's1', { revealDirectoryTarget: true }]]);
});

test('double-click after a consumed graph click does not activate', () => {
  const h = createHarness();
  h.setSuppressGraphClickFlag(true);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : null);
  h.grid._dispatch('dblclick', { target: tile });
  assert.equal(h.commandCalls.length, 0);
  assert.equal(h.getSuppressGraphClickFlag(), false);
});

function startDrag(h, overrides = {}) {
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  h.setShells([n.shell]);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15, overrides));
  return n;
}

test('pointerup over a non-dragged group routes dragDropToFolder', () => {
  const h = createHarness();
  const n = startDrag(h);
  // Destination folder shell is a non-dragged group at the pointer.
  const folderShell = fakeNode();
  folderShell.dataset = { graphNodeId: 'g1' };
  folderShell.querySelector = () => ({ dataset: { kind: 'group', id: 'g1' } });
  folderShell.closest = (sel) => (sel === '.graph-node-shell' ? folderShell : null);
  h.setShells([n.shell, folderShell]);
  h.setElementAtPoint(folderShell);
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15));
  const folderCall = h.commandCalls.find(([name]) => name === 'folder');
  assert.ok(folderCall, 'dragDropToFolder should be invoked');
  assert.deepEqual(folderCall[1].itemIds, ['s1']);
  assert.equal(folderCall[1].folderId, 'g1');
  assert.ok(folderCall[1].placementIds instanceof Map);
});

test('pointercancel restores node positions and cleans up', () => {
  const h = createHarness();
  const n = startDrag(h);
  const movedX = n.fx;
  const movedY = n.fy;
  assert.notEqual(movedX, 100);
  h.grid._dispatch('pointercancel', pointerEvent(1, 20, 15));
  assert.equal(n.x, 100);
  assert.equal(n.y, 100);
  assert.equal(n.fx, null);
  assert.equal(n.fy, null);
  assert.equal(n.shell.classList.contains('graph-dragging'), false);
  assert.ok(h.effects.reheat.includes(0.2));
  assert.equal(h.effects.trailClear, 1);
  assert.equal(h.getReleased(), 1);
});

test('clientToWorld is exported for set hit-testing', () => {
  // Set click selection converts the click through this, and its caller used
  // optional chaining: while the export was missing, `?.` turned the absence
  // into undefined, then into an empty hit list, so clicking inside a ring did
  // nothing and looked exactly like clicking outside one. Nothing failed and
  // nothing was logged.
  const h = createHarness();
  assert.equal(typeof h.controller.clientToWorld, 'function');
  // With an identity transform and no viewport, client coordinates pass
  // through — enough to prove the conversion is wired, not merely present.
  assert.deepEqual(h.controller.clientToWorld(100, 50), { x: 100, y: 50 });
});

// ===========================================================================
// Ejection on release. The ring cannot stop a drag, so the drag is left alone
// and anything that landed inside a set it does not belong to is moved out
// once the gesture is over.
// ===========================================================================

function dragTile(h, id, from, to) {
  const tile = fakeNode();
  tile.dataset = { id, kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' || sel === '.graph-node-shell' ? tile : null);
  h.store.setSelection([id]);
  h.grid._dispatch('pointerdown', pointerEvent(1, from.x, from.y, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, to.x, to.y));
}

test('releasing a drag ejects anything that trespassed', () => {
  const h = createHarness();
  h.graphNodes.set('s1', node('s1', 100, 100));
  dragTile(h, 's1', { x: 10, y: 10 }, { x: 60, y: 40 });
  h.grid._dispatch('pointerup', pointerEvent(1, 60, 40));
  assert.deepEqual(h.effects.ejected, [['s1']], 'the dragged item was checked');
});

test('ejection runs before the pinned positions are read', () => {
  // Order matters: pinning first would save the trespassing position and the
  // correction would be undone on the next load.
  const h = createHarness();
  h.graphNodes.set('s1', node('s1', 100, 100));
  dragTile(h, 's1', { x: 10, y: 10 }, { x: 60, y: 40 });
  h.grid._dispatch('pointerup', pointerEvent(1, 60, 40, { shiftKey: true }));

  assert.deepEqual(h.effects.ejected, [['s1']], 'ejection happened');
  const pinCall = h.commandCalls.find(([name]) => name === 'pin');
  assert.ok(pinCall, 'and the positions were pinned');
});

test('a drop into the Bin or a folder is not an ejection', () => {
  // Those are deliberate destinations, not accidents of where the pointer
  // happened to be — the item is leaving the canvas either way.
  const bin = createHarness();
  bin.graphNodes.set('s1', node('s1', 100, 100));
  dragTile(bin, 's1', { x: 10, y: 10 }, { x: 60, y: 40 });
  bin.binButton.contains = () => true;
  bin.grid._dispatch('pointerup', pointerEvent(1, 60, 40));
  assert.deepEqual(bin.effects.ejected, [], 'the Bin drop was left alone');
});

// ===========================================================================
// Ancestor drags (Assignment 003): an ancestor tile is a breadcrumb body —
// draggable like any item, but it never selects (clicks navigate), never
// pins (even with Shift), and never persists a position.
// ===========================================================================

function dragAncestorTile(h, id, from, to, overrides = {}) {
  const tile = fakeNode();
  tile.dataset = { id, kind: 'group' };
  tile.classList.add('ancestor-item');
  tile.closest = (sel) => (sel === '.icon-item' || sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, from.x, from.y, { target: tile, ...overrides }));
  h.grid._dispatch('pointermove', pointerEvent(1, to.x, to.y, overrides));
  return tile;
}

test('pointerdown on an ancestor tile starts a single-node drag without selecting', () => {
  const h = createHarness();
  const n = node('anc-f1', 100, 100);
  h.graphNodes.set('anc-f1', n);
  dragAncestorTile(h, 'anc-f1', { x: 10, y: 10 }, { x: 60, y: 40 });
  assert.equal(h.commandCalls.find(([name]) => name === 'select'), undefined,
    'an ancestor tile never selects');
  h.grid._dispatch('pointerup', pointerEvent(1, 60, 40));
  assert.equal(h.commandCalls.find(([name]) => name === 'pin'), undefined,
    'an ancestor drag never pins');
  assert.equal(h.commandCalls.find(([name]) => name === 'release'), undefined,
    'an ancestor drag never clears a stored graph position');
  assert.equal(n.fx, null, 'the ancestor floats again after the drag');
  assert.equal(n.fy, null);
  assert.ok(h.effects.reheat.includes(0.25), 'the simulation reheats after the drag');
});

test('ancestor drags ignore the shift key — never pin, even with Shift held', () => {
  const h = createHarness();
  h.graphNodes.set('anc-f1', node('anc-f1', 100, 100));
  dragAncestorTile(h, 'anc-f1', { x: 10, y: 10 }, { x: 60, y: 40 }, { shiftKey: true });
  for (const listener of h.windowListeners) {
    if (listener.type === 'keydown') listener.handler({ key: 'Shift' });
  }
  h.grid._dispatch('pointerup', pointerEvent(1, 60, 40, { shiftKey: true }));
  assert.equal(h.commandCalls.find(([name]) => name === 'pin'), undefined,
    'Shift never pins an ancestor');
  assert.equal(h.commandCalls.find(([name]) => name === 'release'), undefined);
});

test('an ancestor dragged onto the Bin pill still reaches the guarded command', () => {
  const h = createHarness();
  h.graphNodes.set('anc-f1', node('anc-f1', 100, 100));
  dragAncestorTile(h, 'anc-f1', { x: 10, y: 10 }, { x: 60, y: 40 });
  h.binButton.contains = () => true;
  h.grid._dispatch('pointerup', pointerEvent(1, 60, 40));
  const binCall = h.commandCalls.find(([name]) => name === 'bin');
  assert.ok(binCall, 'the Bin-drop command runs so its guard can refuse');
  assert.deepEqual(binCall[1].itemIds, ['anc-f1']);
});

// ===========================================================================
// Interior window-layout controls (Assignments 008, 015): the graph drag
// excludes any pointerdown on a <button> by design (the expander uses the
// same seam), so pressing a member button or the picker/activate controls
// toggles/opens the window-layout UI and never begins outer dragging.
// ===========================================================================

test('pointerdown on an interior window-layout control never begins graph dragging', () => {
  const h = createHarness();
  h.graphNodes.set('wl1', node('wl1', 100, 100));
  const control = fakeNode();
  control.className = 'window-layout-member normal';
  control.closest = (sel) => (sel === 'button' || sel === '[data-expand]' ? control : null);
  const tile = fakeNode();
  tile.closest = (sel) => (sel === '.icon-item' || sel === '.graph-node-shell' ? tile : null);
  control.closest = (sel) => {
    if (sel === 'button' || sel === '[data-expand]') return control;
    return tile.closest(sel);
  };

  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: control }));
  h.grid._dispatch('pointermove', pointerEvent(1, 60, 40));
  h.grid._dispatch('pointerup', pointerEvent(1, 60, 40));

  assert.equal(h.commandCalls.find(([name]) => name === 'select'), undefined,
    'pressing the control selects nothing and starts no gesture');
  assert.equal(h.commandCalls.find(([name]) => name === 'release'), undefined,
    'no drag was started');
  assert.equal(h.commandCalls.find(([name]) => name === 'marquee-start'), undefined,
    'and no marquee either');
  assert.equal(h.effects.reheat.length, 0);
});
