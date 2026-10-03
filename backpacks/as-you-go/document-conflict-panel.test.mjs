import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFLICT_PANEL_CLASS,
  createDocumentConflictPanel,
} from './public/app/components/document-conflict-panel.js';

/** The smallest DOM the panel actually uses. */
function fakeDocument() {
  function createElement(tag) {
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      type: '',
      disabled: false,
      children: [],
      parent: null,
      attributes: {},
      listeners: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
      appendChild(child) { child.parent = this; this.children.push(child); return child; },
      remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
      },
      querySelectorAll(selector) {
        const wanted = selector.toUpperCase();
        const found = [];
        const walk = (n) => {
          for (const child of n.children) {
            if (child.tagName === wanted) found.push(child);
            walk(child);
          }
        };
        walk(this);
        return found;
      },
      click() { for (const handler of this.listeners.click ?? []) handler(); },
      find(className) {
        if (this.className === className) return this;
        for (const child of this.children) {
          const hit = child.find(className);
          if (hit) return hit;
        }
        return null;
      },
    };
    return node;
  }
  return { createElement, body: createElement('body') };
}

function harness({ confirmResult = true } = {}) {
  const document = fakeDocument();
  const calls = { useLatest: 0, keepMine: 0, confirmed: [] };
  let releaseKeepMine;
  const panel = createDocumentConflictPanel({
    document,
    onUseLatest: async () => { calls.useLatest += 1; },
    onKeepMine: () => {
      calls.keepMine += 1;
      return new Promise((resolve) => { releaseKeepMine = resolve; });
    },
    confirm: async (message) => { calls.confirmed.push(message); return confirmResult; },
  });
  return { document, panel, calls, release: () => releaseKeepMine?.() };
}

test('the panel states what happened in plain language and offers exactly two ways out', () => {
  const h = harness();
  const element = h.panel.show(h.document.body);

  assert.equal(element.className, CONFLICT_PANEL_CLASS);
  const message = element.find(`${CONFLICT_PANEL_CLASS}__message`).textContent;
  assert.match(message, /changed somewhere else/);
  assert.match(message, /still here, but it is not saved/);
  assert.doesNotMatch(message, /revision|JSON|CAS|conflict state/i, 'no machinery in the creator-facing copy');

  const buttons = element.querySelectorAll('button');
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((b) => b.textContent), ['Use latest version', 'Keep my version']);
});

test('the panel is not modal: it announces politely rather than trapping the creator', () => {
  const h = harness();
  const element = h.panel.show(h.document.body);
  assert.equal(element.attributes.role, 'status');
  assert.equal(element.attributes['aria-live'], 'polite');
  assert.notEqual(element.attributes.role, 'dialog');
});

test('Use latest version needs no confirmation — it only discards this surface own unsaved change', async () => {
  const h = harness();
  const element = h.panel.show(h.document.body);
  element.find(`${CONFLICT_PANEL_CLASS}__use-latest`).click();
  await Promise.resolve();
  assert.equal(h.calls.useLatest, 1);
  assert.deepEqual(h.calls.confirmed, [], 'discarding your own unsaved change is not destructive to anyone else');
});

test('Keep my version confirms first, and says what it will destroy', async () => {
  const h = harness();
  const element = h.panel.show(h.document.body);
  element.find(`${CONFLICT_PANEL_CLASS}__keep-mine`).click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.calls.confirmed, ['This will replace changes saved elsewhere.']);
  assert.equal(h.calls.keepMine, 1);
});

test('declining the confirmation leaves the conflict exactly where it was', async () => {
  const h = harness({ confirmResult: false });
  const element = h.panel.show(h.document.body);
  element.find(`${CONFLICT_PANEL_CLASS}__keep-mine`).click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.calls.keepMine, 0, 'nothing is replaced when the creator declines');
  assert.equal(h.panel.visible, true);
});

test('a recovery in flight disables both actions so a double click cannot race itself', async () => {
  const h = harness();
  const element = h.panel.show(h.document.body);
  const keepMine = element.find(`${CONFLICT_PANEL_CLASS}__keep-mine`);

  keepMine.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(keepMine.disabled, true);
  assert.equal(element.find(`${CONFLICT_PANEL_CLASS}__use-latest`).disabled, true);

  keepMine.click();
  await Promise.resolve();
  assert.equal(h.calls.keepMine, 1, 'the second click is ignored while the first is in flight');

  h.release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(keepMine.disabled, false);
});

test('the panel follows the coordinator role and never becomes a second source of truth', () => {
  const h = harness();
  h.panel.syncToRole('conflict', h.document.body);
  assert.equal(h.panel.visible, true);
  assert.equal(h.document.body.children.length, 1);

  h.panel.syncToRole('writer', h.document.body);
  assert.equal(h.panel.visible, false);
  assert.equal(h.document.body.children.length, 0);

  h.panel.syncToRole('view', h.document.body);
  assert.equal(h.panel.visible, false);
});

test('showing twice does not stack panels', () => {
  const h = harness();
  h.panel.show(h.document.body);
  h.panel.show(h.document.body);
  assert.equal(h.document.body.children.length, 1);
});
