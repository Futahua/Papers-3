import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromptTreeContextMenu } from './public/app/components/prompt-tree-context-menu.js';

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    dataset: {},
    hidden: false,
    textContent: '',
    appendChild(child) {
      if (typeof child !== 'string') {
        node.children.push(child);
        child.parentNode = node;
      }
      return child;
    },
    append(...children) { for (const c of children) node.appendChild(c); },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name]; },
    addEventListener(type, fn, options) {
      const entry = { fn, options };
      node.listeners[type] = node.listeners[type] || [];
      node.listeners[type].push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          node.listeners[type] = (node.listeners[type] || []).filter((e) => e !== entry);
        });
      }
    },
    dispatch(type, event = {}) {
      const results = [];
      let current = node;
      while (current) {
        for (const entry of current.listeners[type] || []) results.push(entry.fn(event));
        current = current.parentNode;
      }
      return results.length === 1 ? results[0] : Promise.all(results);
    },
    querySelectorAll(selector) {
      const roleMatch = selector.match(/^\[role="([^"]+)"\]$/);
      const role = roleMatch ? roleMatch[1] : null;
      const found = [];
      const walk = (current) => {
        for (const child of current.children) {
          if (child.attributes.role === role) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
    contains(target) {
      let current = target;
      while (current) {
        if (current === node) return true;
        current = current.parentNode;
      }
      return false;
    },
    focus() {},
    style: { setProperty() {} },
  };
  return node;
}

function harness() {
  const menu = makeNode('div');
  const documentMock = {
    createElement: (tag) => makeNode(tag),
    addEventListener(type, fn, options) {
      const entry = { fn, options };
      documentMock.listeners[type] = documentMock.listeners[type] || [];
      documentMock.listeners[type].push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          documentMock.listeners[type] = (documentMock.listeners[type] || []).filter((e) => e !== entry);
        });
      }
    },
    listeners: {},
    dispatch(type, event = {}) {
      const results = [];
      for (const entry of documentMock.listeners[type] || []) results.push(entry.fn(event));
      return results.length === 1 ? results[0] : Promise.all(results);
    },
  };
  const actions = [];
  const menuCtrl = createPromptTreeContextMenu({ document: documentMock, menu });
  menuCtrl.mount();
  return { menu, documentMock, menuCtrl, actions };
}

test('open renders items and emits the chosen action', () => {
  const h = harness();
  h.menuCtrl.open({
    x: 10, y: 20,
    items: [{ id: 'copy', label: 'Copy' }, { id: 'delete', label: 'Delete' }],
    onAction: (id) => h.actions.push(id),
  });
  assert.equal(h.menu.hidden, false);
  const buttons = h.menu.querySelectorAll('[role="menuitem"]');
  assert.equal(buttons.length, 2);
  buttons[1].dispatch('click', { target: buttons[1], preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(h.actions, ['delete']);
  assert.equal(h.menu.hidden, true, 'closes after action');
});

test('Escape closes the menu without an action', () => {
  const h = harness();
  h.menuCtrl.open({ x: 0, y: 0, items: [{ id: 'copy', label: 'Copy' }], onAction: (id) => h.actions.push(id) });
  h.menu.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(h.menu.hidden, true);
  assert.deepEqual(h.actions, []);
});

test('keyboard navigation selects items and Enter emits the active one', () => {
  const h = harness();
  h.menuCtrl.open({
    x: 0, y: 0,
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
    onAction: (id) => h.actions.push(id),
  });
  h.menu.dispatch('keydown', { key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
  h.menu.dispatch('keydown', { key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
  h.menu.dispatch('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(h.actions, ['c']);
});

test('outside click dismisses the menu', () => {
  const h = harness();
  h.menuCtrl.open({ x: 0, y: 0, items: [{ id: 'a', label: 'A' }], onAction: (id) => h.actions.push(id) });
  const outside = makeNode('div');
  h.documentMock.dispatch('click', { target: outside });
  assert.equal(h.menu.hidden, true);
});

test('destroy removes the listeners', () => {
  const h = harness();
  const before = (h.menu.listeners.keydown || []).length;
  assert.ok(before > 0);
  h.menuCtrl.destroy();
  assert.equal(h.menu.hidden, true);
  assert.equal(h.menu.listeners.keydown.length, 0);
});
