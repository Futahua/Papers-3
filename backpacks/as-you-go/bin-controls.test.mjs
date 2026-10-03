import assert from 'node:assert/strict';
import test from 'node:test';
import { createBinControls } from './public/app/components/bin-controls.js';

function fakeNode() {
  return {
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
    _dispatch(type, event = {}) {
      for (const entry of [...this._listeners]) {
        if (entry.type === type) entry.handler(event);
      }
    },
  };
}

function createHarness({ binMode = false, selected = [], binnedIds = [] } = {}) {
  const buttons = {
    binButton: fakeNode(),
    deleteAllBin: fakeNode(),
    restoreAllBin: fakeNode(),
  };
  const asks = [];
  let mode = binMode;
  let currentSelected = [...selected];
  let drillDown = 'bin';
  let moved = false;
  let renders = 0;
  let saves = 0;
  let menuClosed = 0;

  const controls = createBinControls({
    elements: buttons,
    getState: () => ({ binned: binnedIds }),
    getBinMode: () => mode,
    setBinMode: (next) => { mode = next; },
    getSelectedIds: () => [...currentSelected],
    clearSelection: () => { currentSelected = []; },
    resetDrillDown: () => { drillDown = 'bin'; },
    binnedItems: (state) => state.binned.map((id) => ({ id })),
    moveToBin: () => { moved = true; },
    confirmDialog: {
      askPermanentDelete: (...args) => asks.push(['delete', ...args]),
      askRestoreConfirm: (...args) => asks.push(['restore', ...args]),
    },
    closeMenu: () => { menuClosed += 1; },
    render: () => { renders += 1; },
    saveWorkspaceView: () => { saves += 1; },
  });

  return {
    controls, buttons, asks,
    getMode: () => mode,
    getDrillDown: () => drillDown,
    getMoved: () => moved,
    getRenders: () => renders,
    getSaves: () => saves,
    getMenuClosed: () => menuClosed,
  };
}

test('bin button with a selection moves it to the bin instead of toggling', () => {
  const h = createHarness({ selected: ['a'] });
  h.controls.mount();
  h.buttons.binButton._dispatch('click');
  assert.equal(h.getMoved(), true);
  assert.equal(h.getMode(), false);
  assert.equal(h.getRenders(), 0);
});

test('bin button with no selection toggles Bin mode and resets drill-down', () => {
  const h = createHarness({});
  h.controls.mount();
  h.buttons.binButton._dispatch('click');
  assert.equal(h.getMode(), true);
  assert.equal(h.getDrillDown(), 'bin');
  assert.equal(h.getRenders(), 1);
  assert.equal(h.getSaves(), 1);
  assert.equal(h.getMenuClosed(), 1);
});

test('delete-all with a selection asks for just that selection', () => {
  const h = createHarness({ selected: ['a', 'b'] });
  h.controls.mount();
  h.buttons.deleteAllBin._dispatch('click');
  assert.deepEqual(h.asks, [['delete', ['a', 'b'], false]]);
});

test('delete-all with no selection asks for every binned item', () => {
  const h = createHarness({ binnedIds: ['x', 'y', 'z'] });
  h.controls.mount();
  h.buttons.deleteAllBin._dispatch('click');
  assert.deepEqual(h.asks, [['delete', ['x', 'y', 'z'], true]]);
});

test('restore-all with no selection asks to restore every binned item', () => {
  const h = createHarness({ binnedIds: ['x'] });
  h.controls.mount();
  h.buttons.restoreAllBin._dispatch('click');
  assert.deepEqual(h.asks, [['restore', ['x'], true]]);
});

test('destroy removes the bin button listener', () => {
  const h = createHarness({});
  h.controls.mount();
  const before = h.buttons.binButton._listeners.length;
  assert.ok(before > 0);
  h.controls.destroy();
  assert.equal(h.buttons.binButton._listeners.length, 0);
});
