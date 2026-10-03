import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextMenu } from './public/app/components/context-menu.js';
import { resolveContextTarget } from './public/app/context-target-model.js';

function createHarness({ binMode = false, clipboard = null, selected = [], selectedSets = [], currentId = 'root' } = {}) {
  const actions = [];
  const menuNode = {
    hidden: null,
    innerHTML: '',
    dataset: {},
    style: {},
    scrollHeight: 120,
    _listeners: [],
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      menuNode._listeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = menuNode._listeners.indexOf(entry);
          if (index >= 0) menuNode._listeners.splice(index, 1);
        });
      }
    },
    _dispatch(type, event) {
      for (const entry of [...menuNode._listeners]) {
        if (entry.type === type) entry.handler(event);
      }
    },
    querySelector() { return null; },
  };

  const menu = createContextMenu({
    elements: { menu: menuNode },
    window: { innerWidth: 1200, innerHeight: 900 },
    getCurrentId: () => currentId,
    getBinMode: () => binMode,
    getClipboard: () => clipboard,
    getSelectedItems: () => selected,
    getSelectedSets: () => selectedSets,
    isWebLink: (candidate) => candidate.target?.startsWith('https://'),
    onAction: (action) => actions.push(action),
  });

  return { menu, menuNode, actions };
}

test('menuButton builds an accessible action button', () => {
  const { menu } = createHarness();
  const plain = menu.menuButton('copy', 'Copy');
  assert.match(plain, /data-action="copy"/);
  assert.match(plain, /role="menuitem"/);
  assert.doesNotMatch(plain, /danger-text/);
  const danger = menu.menuButton('bin', 'Move to Bin', true);
  assert.match(danger, /danger-text/);
});

test('openMenu blank shows creation actions and paste when clipboard exists', () => {
  const { menu, menuNode } = createHarness({ clipboard: { mode: 'copy' } });
  menu.openMenu(100, 100, 'blank', 'parent-group');
  assert.equal(menuNode.hidden, false);
  assert.equal(menuNode.dataset.parent, 'parent-group');
  assert.match(menuNode.innerHTML, /New folder/);
  assert.match(menuNode.innerHTML, /Add shortcut/);
  assert.match(menuNode.innerHTML, /Add web link/);
  assert.match(menuNode.innerHTML, /Paste copied items/);
});

test('openMenu in bin mode shows restore and permanent delete', () => {
  const { menu, menuNode } = createHarness({ binMode: true });
  menu.openMenu(100, 100);
  assert.match(menuNode.innerHTML, /Restore/);
  assert.match(menuNode.innerHTML, /Delete permanently/);
});

test('040 member kind shows only Remove from this layout and records the parent layout', () => {
  const { menu, menuNode } = createHarness();
  menu.openMenu(100, 100, 'member', 'L1');
  assert.equal(menuNode.hidden, false);
  assert.equal(menuNode.dataset.parent, 'L1');
  assert.match(menuNode.innerHTML, /data-action="remove-from-layout"/);
  assert.match(menuNode.innerHTML, /Remove from this layout/);
  assert.doesNotMatch(menuNode.innerHTML, /data-action="copy"/);
  assert.doesNotMatch(menuNode.innerHTML, /data-action="bin"/);
});

test('openMenu with a single selection shows edit/rename and Open', () => {
  const selected = [
    { id: 's1', name: 'App', target: 'C:\\app.exe' },
  ];
  const { menu, menuNode } = createHarness({ selected });
  menu.openMenu(100, 100);
  assert.match(menuNode.innerHTML, /data-action="open"/);
  assert.match(menuNode.innerHTML, /data-action="edit"/);
  assert.doesNotMatch(menuNode.innerHTML, /data-action="rename"/);
});

test('openMenu with a folder offers a new Papers tab action', () => {
  const selected = [{ id: 'g1', name: 'Folder' }];
  const { menu, menuNode } = createHarness({ selected });
  menu.openMenu(100, 100);
  assert.match(menuNode.innerHTML, /data-action="open-new-tab"/);
  assert.match(menuNode.innerHTML, /Open folder in new Papers tab/);
});

test('openMenu with a selected set offers only bounded set actions', () => {
  const { menu, menuNode } = createHarness({ selectedSets: [{ id: 'set-a' }] });
  menu.openMenu(100, 100);
  assert.match(menuNode.innerHTML, /data-action="rename-set"/);
  assert.match(menuNode.innerHTML, /data-action="delete-sets"/);
  assert.doesNotMatch(menuNode.innerHTML, /data-action="bin"/);
});

test('context target prioritizes item, then selected set, then blank space', () => {
  assert.deepEqual(
    resolveContextTarget({ itemId: 'item-1', hitSetIds: ['set-1'], selectedSetIds: new Set(['set-1']) }),
    { kind: 'item', id: 'item-1' },
  );
  assert.deepEqual(
    resolveContextTarget({ hitSetIds: ['set-1', 'set-2'], selectedSetIds: new Set(['set-2']) }),
    { kind: 'set', id: 'set-2' },
  );
  assert.deepEqual(resolveContextTarget({ hitSetIds: ['set-1'], selectedSetIds: new Set() }), { kind: 'blank', id: null });
});

test('click dispatch routes the action to onAction and closes', () => {
  const { menu, menuNode, actions } = createHarness();
  menu.mount();
  menuNode._dispatch('click', { target: { closest: (sel) => ({ dataset: { action: 'paste' } }) } });
  assert.deepEqual(actions, ['paste']);
});

test('destroy removes the menu click listener and closes', () => {
  const { menu, menuNode } = createHarness();
  menu.mount();
  menu.openMenu(100, 100);
  assert.ok(menuNode._listeners.length > 0);
  menu.destroy();
  assert.equal(menuNode._listeners.length, 0);
  assert.equal(menuNode.hidden, true);
  assert.equal(menuNode.innerHTML, '');
});
