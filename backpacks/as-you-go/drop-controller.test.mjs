import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createDropController } from './public/app/interactions/drop-controller.js';

function fakeNode() {
  return {
    classList: { add() {}, remove() {} },
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

function createHarness({ binMode = false } = {}) {
  const store = createWorkspaceStore({
    getState: () => ({}),
    setState: () => {},
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { binMode },
  });
  const grid = fakeNode();
  const hoverNodes = [fakeNode()];
  const elements = { grid };
  const documentMock = {
    querySelectorAll: () => hoverNodes,
  };
  const commandCalls = [];
  const commands = {
    dropUrl: (url, destination) => { commandCalls.push(['url', url, destination]); },
    dropFiles: (files, destination) => { commandCalls.push(['files', files, destination]); },
  };
  const controller = createDropController({
    document: documentMock,
    elements,
    store,
    commands,
  });
  controller.mount();
  return { controller, grid, store, commandCalls, hoverNodes };
}

function dropEvent({ files = [], uriList = '', plain = '', dropEffect, target }) {
  return {
    dataTransfer: {
      files,
      types: files.length > 0 ? ['Files'] : (uriList || plain ? ['text/uri-list'] : []),
      getData: (type) => (type === 'text/uri-list' ? uriList : type === 'text/plain' ? plain : ''),
      dropEffect,
    },
    target,
    relatedTarget: null,
    preventDefault() {},
  };
}

test('dragover adds hover classes on a group tile and sets link effect', () => {
  const h = createHarness();
  const tile = { dataset: { kind: 'group' }, closest: () => tile };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  const tileClass = { add() {}, remove() {} };
  tile.classList = tileClass;
  const event = dropEvent({ files: [{}], dropEffect: '' });
  event.target = tile;
  h.grid._dispatch('dragover', event);
  assert.equal(event.dataTransfer.dropEffect, 'link');
});

test('drop with files routes to dropFiles with the destination', async () => {
  const h = createHarness();
  const file = { name: 'a.txt' };
  const tile = null;
  const event = dropEvent({ files: [file], dropEffect: '' });
  event.target = { closest: () => null };
  event.dataTransfer.files = [file];
  await h.grid._dispatch('drop', event);
  assert.equal(h.commandCalls.length, 1);
  assert.equal(h.commandCalls[0][0], 'files');
  assert.deepEqual(h.commandCalls[0][1], [file]);
});

test('drop with a URL routes to dropUrl', async () => {
  const h = createHarness();
  const event = dropEvent({ uriList: 'https://example.com\n# comment\n', dropEffect: '' });
  event.target = { closest: () => null };
  await h.grid._dispatch('drop', event);
  assert.deepEqual(h.commandCalls, [['url', 'https://example.com', null]]);
});

test('drop cleanup removes hover classes in finally', async () => {
  const h = createHarness();
  let removed = 0;
  h.hoverNodes.forEach((node) => { node.classList.remove = () => { removed += 1; }; });
  const event = dropEvent({ files: [{ name: 'x' }], dropEffect: '' });
  event.target = { closest: () => null };
  await h.grid._dispatch('drop', event);
  assert.ok(removed > 0);
});

test('bin mode ignores drops', async () => {
  const h = createHarness({ binMode: true });
  const event = dropEvent({ files: [{ name: 'x' }], dropEffect: '' });
  event.target = { closest: () => null };
  await h.grid._dispatch('drop', event);
  assert.equal(h.commandCalls.length, 0);
});

test('destroy removes the drop listener', () => {
  const h = createHarness();
  assert.ok(h.grid._listeners.length > 0);
  h.controller.destroy();
  assert.equal(h.grid._listeners.length, 0);
});
