import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createPromptLibraryDialog } from './public/app/components/prompt-library-dialog.js';
import { createHotkeyCatalog } from './public/app/hotkeys-model.js';

function matchSimple(node, selector) {
  if (!node) return false;
  if (selector.startsWith('#')) return node.attributes.id === selector.slice(1);
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('[')) {
    const m = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (!m) return false;
    const attr = m[1];
    const value = m[2];
    const got = node.dataset[attr] ?? node.attributes[attr];
    if (value !== undefined) { if (got !== value) return false; }
    else if (got === undefined) return false;
  } else if (node.tagName !== selector.toUpperCase()) {
    return false;
  }
  return true;
}

function simpleParts(token) {
  const parts = [];
  const re = /([.#][\w-]+|\[[^\]]+\]|[\w-]+)/g;
  let match;
  while ((match = re.exec(token)) !== null) parts.push(match[0]);
  return parts;
}

function matchToken(node, token) {
  for (const part of simpleParts(token)) {
    if (part.startsWith('.')) {
      if (!node.classList.contains(part.slice(1))) return false;
    } else if (part.startsWith('#')) {
      if (node.attributes.id !== part.slice(1)) return false;
    } else if (part.startsWith('[')) {
      const m = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!m) return false;
      const attr = m[1];
      const value = m[2];
      const got = node.dataset[attr] ?? node.attributes[attr];
      if (value !== undefined) { if (got !== value) return false; }
      else if (got === undefined) return false;
    } else if (node.tagName !== part.toUpperCase()) {
      return false;
    }
  }
  return true;
}

function matchDescendant(node, parts, index) {
  if (index < 0) return true;
  if (!matchToken(node, parts[index])) return false;
  if (index === 0) return true;
  let current = node.parentNode;
  while (current) {
    if (matchDescendant(current, parts, index - 1)) return true;
    current = current.parentNode;
  }
  return false;
}

function matches(node, selector) {
  for (const group of selector.split(',')) {
    const parts = group.trim().split(/\s+/);
    if (matchDescendant(node, parts, parts.length - 1)) return true;
  }
  return false;
}

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    isFragment: false,
    children: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    dataset: {},
    value: '',
    checked: false,
    indeterminate: false,
    disabled: false,
    hidden: false,
    draggable: false,
    rows: 0,
    maxLength: 0,
    type: '',
    title: '',
    _style: {},
    appendChild(child) {
      if (typeof child === 'string') return child;
      if (child.isFragment) {
        for (const grandchild of [...child.children]) node.appendChild(grandchild);
        return child;
      }
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    append(...children) { for (const child of children) node.appendChild(child); },
    remove() {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      }
      node.parentNode = null;
    },
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
      const found = [];
      const walk = (current) => {
        for (const child of current.children) {
          if (matches(child, selector)) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
    querySelector(selector) { return node.querySelectorAll(selector)[0] ?? null; },
    closest(selector) {
      let current = node;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
    focus() { focusState.activeElement = node; },
    contains(other) {
      let current = other;
      while (current) {
        if (current === node) return true;
        current = current.parentNode;
      }
      return false;
    },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    style: { setProperty(name, value) { node._style[name] = value; } },
  };
  const classes = new Set();
  Object.defineProperty(node, 'className', {
    get() { return [...classes].join(' '); },
    set(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name);
    },
    configurable: true,
  });
  let textContentValue = '';
  Object.defineProperty(node, 'textContent', {
    get() { return textContentValue; },
    set(value) {
      textContentValue = value;
      if (value === '') node.children = [];
    },
    configurable: true,
  });
  node.classList = {
    add(...names) { for (const n of names) classes.add(n); },
    remove(...names) { for (const n of names) classes.delete(n); },
    toggle(name, force) {
      if (force === undefined) {
        if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      } else if (force) { classes.add(name); } else { classes.delete(name); }
    },
    contains(name) { return classes.has(name); },
  };
  const dataset = new Proxy({}, {
    get(target, key) { return target[key]; },
    set(target, key, value) {
      target[key] = value;
      const attr = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      node.attributes[attr] = value;
      return true;
    },
  });
  node.dataset = dataset;
  return node;
}

/** Focus tracking shared by every fake node, so `activeElement` is real and
 * tests can dispatch a keydown from whatever actually holds focus. */
const focusState = { activeElement: null };

/** Wires the flat id map into the same containment the real markup has:
 *
 *   #prompt-layer > .prompt-library > { header buttons, status,
 *                                       #prompt-tree-viewport > #prompt-card-list
 *                                                             > .prompt-root-surface,
 *                                       #prompt-tree-menu, footer buttons }
 *
 * Without this the fake DOM has no parent chain, so nothing bubbles and a
 * list-scoped listener looks identical to a modal-scoped one — which is
 * exactly how the live Ctrl+Z failure hid behind green tests. */
function buildPromptLayerTree(nodes) {
  // Each harness starts from a clean focus state so no test inherits another
  // test's activeElement.
  focusState.activeElement = null;
  const card = makeNode('div');
  card.className = 'confirm-card prompt-library';
  nodes['prompt-layer'].appendChild(card);
  nodes['prompt-tree-viewport'].className = 'prompt-tree-viewport';
  nodes['prompt-tree-viewport'].setAttribute('tabindex', '0');
  nodes['prompt-card-list'].className = 'prompt-tree-list';
  nodes['prompt-root-surface'].className = 'prompt-root-surface';
  nodes['prompt-tree-menu'].setAttribute('role', 'menu');
  nodes['prompt-page-prompts'].className = 'prompt-page';
  nodes['prompt-page-hotkeys'].className = 'prompt-page hotkeys-page';
  nodes['prompt-page-hotkeys'].hidden = true;
  nodes['hotkey-list'].className = 'hotkey-list';
  // The real markup carries this label; the dialog only ever restores it.
  nodes['prompt-copy-selected'].textContent = 'Copy selected';
  nodes['prompt-tree-viewport'].appendChild(nodes['prompt-card-list']);
  nodes['prompt-tree-viewport'].appendChild(nodes['prompt-root-surface']);
  for (const id of [
    'prompt-add-prompt', 'prompt-add-folder', 'prompt-status', 'prompt-delete-confirm',
    'prompt-tree-viewport', 'prompt-tree-menu', 'prompt-error', 'prompt-cancel',
    'prompt-copy-selected',
  ]) {
    nodes['prompt-page-prompts'].appendChild(nodes[id]);
  }
  card.append(nodes['prompt-tab-prompts'], nodes['prompt-tab-hotkeys'], nodes['prompt-page-prompts'], nodes['prompt-page-hotkeys']);
  nodes['prompt-page-hotkeys'].append(
    nodes['hotkey-status'],
    nodes['edge-opacity-slider'],
    nodes['edge-opacity-value'],
    nodes['outline-opacity-slider'],
    nodes['outline-opacity-value'],
    nodes['region-opacity-slider'],
    nodes['region-opacity-value'],
    nodes['breadcrumb-root-scale-slider'],
    nodes['breadcrumb-root-scale-value'],
    nodes['breadcrumb-middle-scale-slider'],
    nodes['breadcrumb-middle-scale-value'],
    nodes['theme-select'],
    nodes['transparent-background-toggle'],
    nodes['hotkey-list'],
    nodes['hotkey-reset-all'],
  );
  nodes['prompt-delete-confirm'].appendChild(nodes['prompt-delete-message']);
  nodes['prompt-delete-confirm'].appendChild(nodes['prompt-delete-ok']);
  nodes['prompt-delete-confirm'].appendChild(nodes['prompt-delete-cancel']);
  return nodes;
}

const treeFixture = () => ({
  groups: [],
  shortcuts: [],
  view: { promptLibrary: [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev', includeAll: false,
      children: [
        { id: 'prompt-a', type: 'prompt', title: 'Alpha', text: 'one', includeInBatch: true },
        {
          id: 'folder-inner', type: 'folder', title: 'Inner', includeAll: false,
          children: [{ id: 'prompt-b', type: 'prompt', title: 'Beta', text: 'two', includeInBatch: false }],
        },
      ],
    },
    { id: 'prompt-root', type: 'prompt', title: 'Root', text: 'three', includeInBatch: true },
  ] },
});

function createHarness({ initialView = null, copyFails = false, persist = async () => {}, hotkeyCatalog = createHotkeyCatalog(), onViewPreferencesChanged = null } = {}) {
  let state = initialView
    ? { groups: [], shortcuts: [], view: initialView }
    : { groups: [], shortcuts: [], view: { promptLibrary: [] } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist,
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add-prompt', 'prompt-add-folder', 'prompt-tree-viewport', 'prompt-card-list',
    'prompt-root-surface', 'prompt-tree-menu', 'prompt-status',
    'prompt-error', 'prompt-cancel', 'prompt-copy-selected', 'copy-prompt',
    'prompt-delete-confirm', 'prompt-delete-message', 'prompt-delete-ok', 'prompt-delete-cancel',
    'prompt-page-prompts', 'prompt-page-hotkeys', 'prompt-tab-prompts', 'prompt-tab-hotkeys',
    'hotkey-list', 'hotkey-status', 'edge-opacity-slider', 'edge-opacity-value',
    'outline-opacity-slider', 'outline-opacity-value', 'region-opacity-slider', 'region-opacity-value', 'theme-select', 'transparent-background-toggle', 'hotkey-reset-all',
    'breadcrumb-root-scale-slider', 'breadcrumb-root-scale-value', 'breadcrumb-middle-scale-slider', 'breadcrumb-middle-scale-value',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  buildPromptLayerTree(nodes);
  focusState.activeElement = null;
  nodes['prompt-layer'].hidden = true;
  nodes['prompt-status'].setAttribute('role', 'status');
  nodes['prompt-status'].setAttribute('aria-live', 'polite');

  const documentMock = {
    querySelector: (sel) => (sel.startsWith('#') ? nodes[sel.slice(1)] ?? null : nodes['prompt-layer'].querySelector(sel)),
    get activeElement() { return focusState.activeElement; },
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createDocumentFragment: () => { const f = makeNode('fragment'); f.isFragment = true; return f; },
    listeners: {},
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
    dispatch(type, event = {}) {
      const results = [];
      for (const entry of documentMock.listeners[type] || []) results.push(entry.fn(event));
      return results.length === 1 ? results[0] : Promise.all(results);
    },
  };
  const copied = [];
  const statuses = [];
  const dialog = createPromptLibraryDialog({
    document: documentMock,
    store,
    fallbackPrompt: 'FALLBACK PROMPT',
    copyText: (text) => {
      if (copyFails) return Promise.reject(new Error('clipboard blocked'));
      copied.push(text);
      return Promise.resolve();
    },
    setStatus: (message) => statuses.push(message),
    hotkeyCatalog,
    onViewPreferencesChanged,
  });
  dialog.mount();
  return {
    dialog, store, nodes, copied, statuses, document: documentMock,
    getState: () => state,
    rows: () => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row'),
    rowFor: (id) => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row').find((r) => r.dataset.nodeId === id),
    promptRows: () => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row.prompt-prompt-row'),
    folderRows: () => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row.prompt-folder-row'),
    textareaFor: (id) => nodes['prompt-card-list'].querySelectorAll('.prompt-card-details').find((d) => d.dataset.nodeId === id)?.querySelector('.prompt-card-text') ?? null,
    hotkeyRows: () => nodes['hotkey-list'].querySelectorAll('.hotkey-row'),
  };
}

const preventDefault = () => {};
const stopPropagation = () => {};
const open = (h, o) => h.dialog.open(o);

const clickRow = (h, id, modifiers = {}) => {
  const row = h.rowFor(id);
  row.dispatch('click', { target: row, ...modifiers, preventDefault, stopPropagation });
};
/** Dispatches a keydown from whatever currently holds focus and lets it bubble
 * up the real parent chain, exactly as the browser would. This is what proves
 * the listener scope is right rather than just that the callback works. */
const keyOn = (h, event = {}) => {
  const from = h.document.activeElement ?? h.nodes['prompt-tree-viewport'];
  from.dispatch('keydown', { target: from, ...event, preventDefault, stopPropagation });
};
/** Dispatches a keydown from a specific element, bubbling. */
const keyFrom = (node, event = {}) => {
  node.dispatch('keydown', { target: node, preventDefault, stopPropagation, ...event });
};
const openPrompt = (h, id) => {
  const chevron = h.rowFor(id).querySelector('.prompt-card-toggle');
  chevron.dispatch('click', { target: chevron, preventDefault, stopPropagation });
};
const chevronOf = (h, id) => h.rowFor(id).querySelector('.prompt-card-toggle');
/** Edits auto-save, so there is no Save button to click. Committing any open
 * editing session and letting the queued save settle is what "the change has
 * been persisted" now means. */
const save = async (h) => {
  // Commit an open editing session without closing the dialog: clicking a row
  // is what a user does to leave a title/body field.
  const row = h.rows()[0];
  if (row) row.dispatch('click', { target: row, preventDefault, stopPropagation });
  await Promise.resolve();
  await Promise.resolve();
};
/** Clicks the real blank surface below the last row, which bubbles to the
 * viewport — the live "target the top level" gesture. */
const blankClick = (h) => {
  const surface = h.nodes['prompt-root-surface'];
  surface.dispatch('click', { target: surface, preventDefault, stopPropagation });
};

function hotkeyRow(h, actionId) {
  return h.hotkeyRows().find((row) => row.dataset.hotkeyAction === actionId);
}

function hotkeyButton(h, actionId, kind) {
  return hotkeyRow(h, actionId).querySelector(`[data-hotkey-${kind}="${actionId}"]`);
}

test('Hotkeys page renders every injected catalog action and preserves prompt data across page switches', () => {
  const catalog = createHotkeyCatalog([{
    id: 'future.preview', label: 'Preview future action', group: 'Workspace', scope: 'workspace', defaults: ['Alt+P'],
  }]);
  const h = createHarness({
    hotkeyCatalog: catalog,
    initialView: { promptLibrary: [{ id: 'prompt-a', type: 'prompt', title: 'Keep me', text: 'body', includeInBatch: true }] },
  });
  open(h);
  h.nodes['prompt-tab-hotkeys'].dispatch('click', { target: h.nodes['prompt-tab-hotkeys'] });
  assert.equal(h.nodes['prompt-page-hotkeys'].hidden, false);
  assert.equal(h.hotkeyRows().length, catalog.length);
  assert.equal(hotkeyRow(h, 'future.preview').querySelector('.hotkey-label').textContent, 'Preview future action');
  h.nodes['prompt-tab-prompts'].dispatch('click', { target: h.nodes['prompt-tab-prompts'] });
  assert.equal(h.nodes['prompt-page-prompts'].hidden, false);
  assert.equal(h.getState().view.promptLibrary[0].title, 'Keep me');
});

test('Settings binding capture consumes the event, reports conflicts, and permits cross-scope reuse', () => {
  const h = createHarness();
  open(h);
  h.dialog.setActivePage('hotkeys');
  hotkeyButton(h, 'workspace.cut', 'binding').dispatch('click', { target: hotkeyButton(h, 'workspace.cut', 'binding') });
  let prevented = false;
  let stopped = false;
  keyFrom(h.nodes['prompt-page-hotkeys'], {
    key: 'c', ctrlKey: true,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.match(h.nodes['hotkey-status'].textContent, /Already used by/);
  hotkeyButton(h, 'copy-prompts.copy', 'binding').dispatch('click', { target: hotkeyButton(h, 'copy-prompts.copy', 'binding') });
  keyFrom(h.nodes['prompt-page-hotkeys'], { key: 'c', ctrlKey: true, preventDefault, stopPropagation });
  assert.deepEqual(h.getState().view.preferences.hotkeys.overrides['copy-prompts.copy'], ['Ctrl+C']);
});

test('Settings rows expose only binding and reset, and Backspace unassigns', async () => {
  const saves = [];
  const h = createHarness({ persist: async (snapshot) => saves.push(snapshot) });
  open(h);
  h.dialog.setActivePage('hotkeys');
  const row = hotkeyRow(h, 'workspace.copy');
  assert.equal(row.querySelector('.hotkey-defaults'), null);
  assert.equal(row.querySelector('[data-hotkey-change]'), null);
  assert.equal(row.querySelector('[data-hotkey-clear]'), null);
  assert.ok(hotkeyButton(h, 'workspace.copy', 'reset'));
  hotkeyButton(h, 'workspace.copy', 'binding').dispatch('click', { target: hotkeyButton(h, 'workspace.copy', 'binding') });
  keyFrom(h.nodes['prompt-page-hotkeys'], { key: 'Backspace', preventDefault, stopPropagation });
  assert.deepEqual(h.getState().view.preferences.hotkeys.overrides['workspace.copy'], []);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(saves.length > 0);
  hotkeyButton(h, 'workspace.copy', 'reset').dispatch('click', { target: hotkeyButton(h, 'workspace.copy', 'reset') });
  assert.equal(h.getState().view.preferences.hotkeys?.overrides, undefined);
  hotkeyButton(h, 'workspace.copy', 'binding').dispatch('click', { target: hotkeyButton(h, 'workspace.copy', 'binding') });
  keyFrom(h.nodes['prompt-page-hotkeys'], { key: 'k', altKey: true, preventDefault, stopPropagation });
  assert.deepEqual(h.getState().view.preferences.hotkeys.overrides['workspace.copy'], ['Alt+K']);
  h.nodes['hotkey-reset-all'].dispatch('click', { target: h.nodes['hotkey-reset-all'] });
  assert.equal(h.getState().view.preferences.hotkeys?.overrides, undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('Settings edge opacity slider persists, updates immediately, and keeps unknown preferences', async () => {
  const saves = [];
  const h = createHarness({
    persist: async (snapshot) => saves.push(JSON.parse(snapshot)),
    initialView: { preferences: { future: { keep: true } } },
  });
  open(h);
  h.dialog.setActivePage('hotkeys');
  assert.equal(h.nodes['edge-opacity-slider'].value, '0.5');
  assert.equal(h.nodes['edge-opacity-value'].textContent, '50%');
  h.nodes['edge-opacity-slider'].value = '0.8';
  h.nodes['edge-opacity-slider'].dispatch('input', { target: h.nodes['edge-opacity-slider'] });
  assert.equal(h.getState().view.preferences.edgeOpacity, 0.8);
  assert.deepEqual(h.getState().view.preferences.future, { keep: true });
  assert.equal(h.nodes['edge-opacity-value'].textContent, '80%');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saves.at(-1).view.preferences.edgeOpacity, 0.8);
});

test('visual opacity settings persist outline and region values independently', async () => {
  const saves = [];
  const h = createHarness({
    persist: async (snapshot) => saves.push(JSON.parse(snapshot)),
    initialView: { preferences: { outlineOpacity: 0.4, regionOpacity: 0.7 } },
  });
  open(h);
  h.dialog.setActivePage('hotkeys');
  assert.equal(h.nodes['outline-opacity-slider'].value, '0.4');
  assert.equal(h.nodes['outline-opacity-value'].textContent, '40%');
  assert.equal(h.nodes['region-opacity-slider'].value, '0.7');
  h.nodes['outline-opacity-slider'].value = '0.25';
  h.nodes['outline-opacity-slider'].dispatch('input', { target: h.nodes['outline-opacity-slider'] });
  h.nodes['region-opacity-slider'].value = '0.55';
  h.nodes['region-opacity-slider'].dispatch('input', { target: h.nodes['region-opacity-slider'] });
  assert.equal(h.getState().view.preferences.outlineOpacity, 0.25);
  assert.equal(h.getState().view.preferences.regionOpacity, 0.55);
  assert.equal(h.getState().view.preferences.edgeOpacity, undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saves.at(-1).view.preferences.regionOpacity, 0.55);
});

test('Settings theme toggle updates immediately, persists, and removes the light default', async () => {
  const saves = [];
  const applied = [];
  const h = createHarness({
    persist: async (snapshot) => saves.push(JSON.parse(snapshot)),
    initialView: { preferences: { theme: 'dark', future: { keep: true } } },
    onViewPreferencesChanged: (next) => applied.push(next.view.preferences.theme ?? 'light'),
  });
  open(h);
  h.dialog.setActivePage('hotkeys');
  assert.equal(h.nodes['theme-select'].value, 'dark');
  h.nodes['theme-select'].value = 'light';
  h.nodes['theme-select'].dispatch('change', { target: h.nodes['theme-select'] });
  assert.equal(h.getState().view.preferences.theme, undefined);
  assert.deepEqual(h.getState().view.preferences.future, { keep: true });
  assert.equal(h.nodes['theme-select'].value, 'light');
  assert.deepEqual(applied, ['light']);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saves.at(-1).view.preferences.theme, undefined);
});

test('Settings transparent background toggle updates immediately and persists through reload state', async () => {
  const saves = [];
  const h = createHarness({
    persist: async (snapshot) => saves.push(JSON.parse(snapshot)),
    initialView: { preferences: { future: { keep: true } } },
  });
  open(h);
  h.dialog.setActivePage('hotkeys');
  assert.equal(h.nodes['transparent-background-toggle'].checked, false);
  h.nodes['transparent-background-toggle'].checked = true;
  h.nodes['transparent-background-toggle'].dispatch('change', { target: h.nodes['transparent-background-toggle'] });
  assert.equal(h.getState().view.preferences.transparentBackground, true);
  assert.deepEqual(h.getState().view.preferences.future, { keep: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saves.at(-1).view.preferences.transparentBackground, true);

  const reloaded = createHarness({ initialView: h.getState().view });
  open(reloaded);
  reloaded.dialog.setActivePage('hotkeys');
  assert.equal(reloaded.nodes['transparent-background-toggle'].checked, true);
  reloaded.nodes['transparent-background-toggle'].checked = false;
  reloaded.nodes['transparent-background-toggle'].dispatch('change', { target: reloaded.nodes['transparent-background-toggle'] });
  assert.equal(reloaded.getState().view.preferences.transparentBackground, undefined);
});

test('Copy Prompts bindings are scoped to the prompt page and replace Enter', () => {
  const h = createHarness({
    initialView: {
      promptLibrary: treeFixture().view.promptLibrary,
      preferences: { hotkeys: { overrides: { 'copy-prompts.open-or-toggle': ['F3'] } } },
    },
  });
  open(h);
  assert.deepEqual(h.getState().view.preferences.hotkeys.overrides['copy-prompts.open-or-toggle'], ['F3']);
  clickRow(h, 'prompt-root');
  assert.equal(h.document.activeElement, h.rowFor('prompt-root'));
  keyFrom(h.nodes['prompt-layer'], { key: 'Enter' });
  assert.equal(h.rowFor('prompt-root').querySelector('.prompt-card-title'), null, 'old Enter is disabled');
  let prevented = false;
  keyFrom(h.nodes['prompt-layer'], { key: 'F3', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.ok(h.rowFor('prompt-root').querySelector('.prompt-card-title'), 'custom prompt binding opens the prompt');
});

test('Ctrl+Z/Y/Shift+Z drive local undo/redo', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  assert.equal(h.promptRows().length, 3, 'prompt added');
  // Adding focuses the new title input, where Ctrl+Z must stay native. Leave
  // the editor but stay inside the modal, exactly as the user does.
  blankClick(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(h.promptRows().length, 2, 'undo removed the added prompt');
  keyOn(h, { key: 'y', ctrlKey: true });
  assert.equal(h.promptRows().length, 3, 'redo restored the added prompt');
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'z', ctrlKey: true, shiftKey: true });
  assert.equal(h.promptRows().length, 3, 'Ctrl+Shift+Z also redoes');
});

test('Ctrl+Z inside an editable control stays native', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  const added = h.promptRows()[h.promptRows().length - 1];
  const input = added.querySelector('.prompt-card-title');
  input.dispatch('keydown', { target: input, key: 'z', ctrlKey: true, preventDefault, stopPropagation });
  assert.equal(h.promptRows().length, 3, 'tree undo is not triggered from inside an input');
});

test('20 title keystrokes are one undo step', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const input = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  for (let i = 0; i < 20; i += 1) {
    input.value += 'x';
    input.dispatch('input', { target: input });
  }
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  blankClick(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary[1].title, 'Root', 'whole editing session undone in one step');
});

test('delete restores the complete folder subtree on undo', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'Delete' });
  h.nodes['prompt-delete-ok'].dispatch('click', { preventDefault });
  assert.equal(h.rowFor('folder-dev'), undefined);
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary[0].id, 'folder-dev', 'folder restored');
  assert.equal(h.getState().view.promptLibrary[0].children.length, 2, 'subtree restored');
});

test('copy paste is removed by one undo and redone with the same ids', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'c', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const afterPaste = h.getState().view.promptLibrary[0].children.map((n) => n.id);
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'y', ctrlKey: true });
  await save(h);
  assert.deepEqual(h.getState().view.promptLibrary[0].children.map((n) => n.id), afterPaste, 'redo restores the same nodes');
});

test('cut paste restores the exact source position by one undo', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'x', ctrlKey: true });
  blankClick(h);
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  assert.ok(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-a'), 'moved to root');
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.ok(h.getState().view.promptLibrary[0].children.some((n) => n.id === 'prompt-a'), 'restored to original parent');
});

test('expansion and selection alone create no history', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('Nothing to undo'));
});

test('blank click targets the root and creates no history', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'c', ctrlKey: true });
  blankClick(h);
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'blank clears selection');
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary.length, 3, 'copied node pasted at root');
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary.length, 2, 'root paste undone in one step');
});

test('right-click blank space opens the root menu with Paste at top level', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'c', ctrlKey: true });
  const list = h.nodes['prompt-card-list'];
  list.dispatch('contextmenu', { target: list, clientX: 10, clientY: 10, preventDefault });
  const labels = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.ok(labels.includes('Paste at top level'));
  assert.ok(labels.includes('New prompt'));
  assert.ok(labels.includes('New folder'));
  assert.ok(labels.includes('Select all'));
  const pasteItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Paste at top level');
  pasteItem.dispatch('click', { target: pasteItem, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'blank right-click clears row selection');
  assert.equal(h.promptRows().length, 3, 'root paste duplicated a prompt at top level');
});

test('multiple selected rows paste at root by default', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'c', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary.length, 4, 'both copied roots pasted at top level');
});

test('dragging below the final top-level row moves nodes to root', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const src = h.rowFor('prompt-a');
  const list = h.nodes['prompt-card-list'];
  const data = { pointerId: 9 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  list.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target: list, preventDefault, stopPropagation });
  list.dispatch('pointerup', { ...data, clientX: 200, clientY: 200, target: list, preventDefault, stopPropagation });
  await save(h);
  assert.ok(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-a'), 'dragged to root');
  assert.ok(h.getState().view.promptLibrary[0].children.every((n) => n.id !== 'prompt-a'), 'left its folder');
});

test('Cancel after undo/redo leaves the saved store unchanged', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'y', ctrlKey: true });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary.length, 2, 'saved store untouched by undo/redo drafts');
});

test('reopening the dialog starts with empty local history', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  open(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('Nothing to undo'));
});

test('right-clicking the copy button opens the library', () => {
  const h = createHarness({ initialView: treeFixture().view });
  h.nodes['copy-prompt'].dispatch('contextmenu', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, false);
  assert.ok(h.rows().length > 0);
});

test('left-click selects one row and ctrl-click toggles without clearing', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true', 'ctrl keeps prior selection');
  clickRow(h, 'prompt-a', { ctrlKey: true });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'ctrl toggles off');
});

test('pointerdown without movement never mutates selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  const row = h.rowFor('prompt-root');
  row.dispatch('pointerdown', { pointerId: 3, button: 0, clientX: 50, clientY: 50, target: row });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true', 'selection untouched by pointerdown');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false');
});

test('drag threshold selects an unselected drag source once and suppresses the following click', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  const src = h.rowFor('prompt-root');
  const target = h.rowFor('folder-dev');
  const data = { pointerId: 4 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false', 'still unselected before threshold');
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'selected once at threshold');
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  const selectedBeforeClick = h.rowFor('prompt-root').getAttribute('aria-selected');
  target.dispatch('click', { target, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), selectedBeforeClick, 'post-drag synthetic click suppressed');
});

test('folder title single-click selects without expanding', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const title = h.rowFor('folder-inner').querySelector('.prompt-folder-title');
  title.dispatch('click', { target: title, preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true', 'title selects the folder');
  assert.equal(h.rowFor('prompt-b'), undefined, 'title does not expand');
});

test('folder chevron expands without selecting', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const chevron = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  chevron.dispatch('click', { target: chevron, preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-b'), 'chevron expands the folder');
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'false', 'chevron leaves selection untouched');
});

test('shift-click selects the visible range', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { shiftKey: true });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true');
});

test('right-click preserves the selected group and selects an unselected row alone', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  h.rowFor('prompt-a').dispatch('contextmenu', { target: h.rowFor('prompt-a'), clientX: 10, clientY: 10, preventDefault });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'existing group preserved');
  h.rowFor('folder-inner').dispatch('contextmenu', { target: h.rowFor('folder-inner'), clientX: 10, clientY: 10, preventDefault });
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'unselected row selects alone');
});

test('checkbox and chevron clicks never alter row selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  h.rowFor('prompt-root').querySelector('.prompt-checkbox').dispatch('click', { target: h.rowFor('prompt-root').querySelector('.prompt-checkbox'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'checkbox leaves selection');
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'chevron leaves selection');
});

test('blank click clears selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  h.nodes['prompt-card-list'].dispatch('click', { target: h.nodes['prompt-card-list'], preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false');
});

test('Ctrl+A selects every visible row', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  keyOn(h, { key: 'a', ctrlKey: true });
  const selected = h.rows().filter((r) => r.getAttribute('aria-selected') === 'true').length;
  assert.equal(selected, h.rows().length, 'all visible rows selected');
});

test('double-clicking a prompt copies its current draft text only', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'unsaved draft body';
  textarea.dispatch('input', { target: textarea });
  h.rowFor('prompt-root').dispatch('dblclick', { target: h.rowFor('prompt-root'), preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['unsaved draft body']);
    assert.equal(h.nodes['prompt-status'].textContent, 'Prompt copied.');
    assert.ok(h.nodes['prompt-status'].classList.contains('prompt-status-copied'));
  });
});

test('Settings dual breadcrumb slider persists both ordered handles and applies immediately', async () => {
  const saves = [];
  const applied = [];
  const h = createHarness({
    persist: async (snapshot) => saves.push(JSON.parse(snapshot)),
    initialView: { preferences: { future: { keep: true } } },
    onViewPreferencesChanged: (next) => applied.push(next.view.preferences),
  });
  open(h);
  h.dialog.setActivePage('hotkeys');
  assert.equal(h.nodes['breadcrumb-root-scale-slider'].value, '0.3');
  assert.equal(h.nodes['breadcrumb-middle-scale-slider'].value, '0.6');
  h.nodes['breadcrumb-root-scale-slider'].value = '0.45';
  h.nodes['breadcrumb-root-scale-slider'].dispatch('input', { target: h.nodes['breadcrumb-root-scale-slider'] });
  h.nodes['breadcrumb-middle-scale-slider'].value = '0.8';
  h.nodes['breadcrumb-middle-scale-slider'].dispatch('input', { target: h.nodes['breadcrumb-middle-scale-slider'] });
  assert.equal(h.getState().view.preferences.breadcrumbRootScale, 0.45);
  assert.equal(h.getState().view.preferences.breadcrumbMiddleScale, 0.8);
  assert.equal(h.nodes['breadcrumb-root-scale-value'].textContent, '45%');
  assert.equal(h.nodes['breadcrumb-middle-scale-value'].textContent, '80%');
  assert.equal(h.nodes['breadcrumb-root-scale-slider'].max, '0.8');
  assert.equal(h.nodes['breadcrumb-middle-scale-slider'].min, '0.45');
  assert.deepEqual(h.getState().view.preferences.future, { keep: true });
  assert.equal(applied.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saves.at(-1).view.preferences.breadcrumbMiddleScale, 0.8);
});

test('an individual prompt copy clears its notification after three seconds', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.rowFor('prompt-root').dispatch('dblclick', {
    target: h.rowFor('prompt-root'), preventDefault, stopPropagation,
  });
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 2900));
  assert.equal(h.nodes['prompt-status'].textContent, 'Prompt copied.', 'still visible before the deadline');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(h.nodes['prompt-status'].textContent, '', 'cleared after three seconds');
});

test('double-clicking a folder expands it instead of copying', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.rowFor('folder-inner').dispatch('dblclick', { target: h.rowFor('folder-inner'), preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-b'), 'collapsed folder expanded on double-click');
  assert.deepEqual(h.copied, []);
  h.rowFor('folder-inner').dispatch('dblclick', { target: h.rowFor('folder-inner'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-b'), undefined, 'double-click toggles back');
});

test('multiple prompt editors remain open without duplicate title fields', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-a');
  openPrompt(h, 'prompt-root');
  const rootRow = h.rowFor('prompt-root');
  assert.ok(rootRow.querySelector('.prompt-card-title'), 'editor opens');
  assert.equal(rootRow.querySelectorAll('.prompt-card-title').length, 1, 'no duplicate title field');
  assert.equal(rootRow.querySelector('.prompt-prompt-title'), null, 'collapsed title replaced inline');
  const firstRow = h.rowFor('prompt-a');
  assert.ok(firstRow.querySelector('.prompt-card-title'), 'first editor remains open');
  assert.equal(firstRow.querySelectorAll('.prompt-card-title').length, 1, 'first editor has one title field');
});

test('resized prompt editor height persists and restores on reopen', async () => {
  const saves = [];
  const view = treeFixture().view;
  view.promptLibrary[1].editorHeight = 240;
  const h = createHarness({ initialView: view, persist: async (snapshot) => saves.push(JSON.parse(snapshot)) });
  open(h);
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  assert.equal(textarea.style.height, '240px');
  let height = 240;
  textarea.getBoundingClientRect = () => ({ top: 0, left: 0, width: 400, height, right: 400, bottom: height });
  textarea.dispatch('pointerdown', { target: textarea, clientX: 398, clientY: 238 });
  height = 330;
  h.document.dispatch('pointerup', { target: textarea, clientX: 398, clientY: 328 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.getState().view.promptLibrary[1].editorHeight, 330);
  assert.equal(saves.at(-1).view.promptLibrary[1].editorHeight, 330);
  h.dialog.close();
  open(h);
  openPrompt(h, 'prompt-root');
  assert.equal(h.textareaFor('prompt-root').style.height, '330px');
});

test('title and text survive collapse and re-render', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const titleInput = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  titleInput.value = 'Renamed';
  titleInput.dispatch('input', { target: titleInput });
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'edited body';
  textarea.dispatch('input', { target: textarea });
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  openPrompt(h, 'prompt-root');
  assert.equal(h.rowFor('prompt-root').querySelector('.prompt-card-title').value, 'Renamed');
  assert.equal(h.textareaFor('prompt-root').value, 'edited body');
  await save(h);
  assert.equal(h.getState().view.promptLibrary[1].title, 'Renamed');
  assert.equal(h.getState().view.promptLibrary[1].text, 'edited body');
});

test('folder F2 rename commits on Enter and cancels on Escape', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'F2' });
  let input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  assert.ok(input, 'rename input appears');
  input.value = 'Development';
  input.dispatch('input', { target: input });
  input.dispatch('keydown', { target: input, key: 'Enter', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Development');
  // Committing the rename removes the input; re-focus the row before F2.
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'F2' });
  input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Discarded';
  input.dispatch('input', { target: input });
  input.dispatch('keydown', { target: input, key: 'Escape', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Development');
  await save(h);
  assert.equal(h.getState().view.promptLibrary[0].title, 'Development');
});

test('folder rename commits on focusout', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'F2' });
  const input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Blurred';
  input.dispatch('input', { target: input });
  input.dispatch('focusout', { target: input, preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Blurred');
});

test('a folder rename is NOT committed when focus leaves for the Quick Run palette', () => {
  // The reviewer's rule, at the one place in this dialog that could break it: committing on focusout is
  // right when the reader clicked somewhere else, and wrong when a launcher took focus. A half-typed name
  // must not be committed by pressing a chord, and it must not be rolled back either - both are invisible
  // resolutions of something the creator was still editing.
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'F2' });
  const input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Half typed';
  input.dispatch('input', { target: input });

  // Focus went into the palette. The dialog is allowed to know the layer and nothing else about Quick Run.
  input.dispatch('focusout', {
    target: input,
    preventDefault,
    stopPropagation,
    relatedTarget: { closest: (selector) => (selector === '#quick-run-layer' ? { id: 'quick-run-layer' } : null) },
  });
  assert.equal(
    h.rowFor('folder-dev').querySelector('.prompt-folder-rename').value,
    'Half typed',
    'the rename is still live and its buffer is untouched',
  );
  assert.ok(
    h.rowFor('folder-dev').querySelector('.prompt-folder-rename'),
    'the rename editor is still there and still live',
  );
  assert.equal(
    Boolean(h.rowFor('folder-dev').querySelector('.prompt-folder-title')),
    false,
    'and nothing was committed behind the palette',
  );

  // The ordinary case is unchanged: focus left for somewhere this dialog does not know, so it commits.
  input.dispatch('focusout', {
    target: input,
    preventDefault,
    stopPropagation,
    relatedTarget: { closest: () => null },
  });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Half typed');
});

test('multiple folders can remain expanded; collapse removes hidden selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.rowFor('folder-inner').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-inner').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-b'), 'deep folder expands');
  clickRow(h, 'prompt-b', { ctrlKey: true });
  clickRow(h, 'folder-inner', { ctrlKey: true });
  assert.equal(h.rowFor('prompt-b').getAttribute('aria-selected'), 'true');
  h.rowFor('folder-inner').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-inner').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-b'), undefined, 'folder collapsed');
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true', 'hidden selection repaired to the folder');
});

test('prompt and folder checkboxes update config without touching selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  const promptCheckbox = h.rowFor('prompt-root').querySelector('.prompt-checkbox');
  promptCheckbox.checked = false;
  promptCheckbox.dispatch('change', { target: promptCheckbox });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true');
  const folderCheckbox = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  folderCheckbox.checked = true;
  folderCheckbox.dispatch('change', { target: folderCheckbox });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').checked, true);
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').indeterminate, false);
});

test('folder includeAll never rewrites descendant prompt checkboxes', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const folderCheckbox = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  folderCheckbox.checked = true;
  folderCheckbox.dispatch('change', { target: folderCheckbox });
  await save(h);
  const saved = h.getState().view.promptLibrary[0];
  assert.equal(saved.includeAll, true);
  assert.equal(saved.children[0].includeInBatch, true);
  assert.equal(saved.children[1].children[0].includeInBatch, false, 'child state preserved');
});

test('checkboxes carry explicit accessible labels', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.rowFor('prompt-a').querySelector('.prompt-checkbox').getAttribute('aria-label'), 'Include Alpha in batch');
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').getAttribute('aria-label'), 'Include every prompt inside Dev');
});

test('context menu for a single prompt offers copy/edit/include/delete', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  h.rowFor('prompt-root').dispatch('contextmenu', { target: h.rowFor('prompt-root'), clientX: 10, clientY: 10, preventDefault });
  const labels = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.deepEqual(labels, ['Open / Edit', 'Copy prompt text', 'Copy item', 'Cut item', 'Exclude from batch', 'Delete']);
});

test('context menu for a folder offers expand/rename/include/new-inside/delete', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  h.rowFor('folder-dev').dispatch('contextmenu', { target: h.rowFor('folder-dev'), clientX: 10, clientY: 10, preventDefault });
  const labels = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.ok(labels.includes('Collapse'));
  assert.ok(labels.includes('Rename'));
  assert.ok(labels.includes('New prompt inside'));
  assert.ok(labels.includes('New folder inside'));
  assert.ok(labels.includes('Delete'));
});

test('context menu include/exclude updates the node', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  h.rowFor('prompt-a').dispatch('contextmenu', { target: h.rowFor('prompt-a'), clientX: 10, clientY: 10, preventDefault });
  const includeItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Exclude from batch');
  includeItem.dispatch('click', { target: includeItem, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-a').querySelector('.prompt-checkbox').checked, false, 'prompt excluded');
});

test('context-menu Copy prompt text copies the draft prompt body only', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'unsaved body';
  textarea.dispatch('input', { target: textarea });
  clickRow(h, 'prompt-root');
  h.rowFor('prompt-root').dispatch('contextmenu', { target: h.rowFor('prompt-root'), clientX: 10, clientY: 10, preventDefault });
  const copyItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Copy prompt text');
  copyItem.dispatch('click', { target: copyItem, preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['unsaved body']);
    assert.ok(h.nodes['prompt-status'].textContent.includes('Prompt copied'), 'feedback is local to the modal');
  });
});

test('Delete key deletes the selected roots once', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'Delete' });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, false, 'multi-selection confirms');
  h.nodes['prompt-delete-ok'].dispatch('click', { preventDefault });
  assert.equal(h.rowFor('prompt-a'), undefined);
  assert.equal(h.rowFor('prompt-root'), undefined);
  await save(h);
  assert.equal(h.getState().view.promptLibrary[0].children[0].children[0].id, 'prompt-b', 'remaining prompts preserved');
});

test('the final prompt cannot be deleted through folder confirmation', () => {
  const view = { promptLibrary: [
    { id: 'folder-x', type: 'folder', title: 'X', includeAll: false, children: [{ id: 'prompt-p', type: 'prompt', title: 'P', text: 'body', includeInBatch: true }] },
  ] };
  const h = createHarness({ initialView: view });
  open(h);
  clickRow(h, 'folder-x');
  keyOn(h, { key: 'Delete' });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, true, 'impossible delete never confirmed');
  assert.ok(h.nodes['prompt-error'].textContent.includes('at least one'));
  assert.ok(h.rowFor('folder-x'), 'folder intact');
});

test('confirmation message counts contained prompts', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'Delete' });
  assert.ok(h.nodes['prompt-delete-message'].textContent.includes('2 contained prompts'));
});

test('dragging a selected row moves the complete selection atomically in order', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  const src = h.rowFor('prompt-a');
  const target = h.rowFor('folder-inner');
  const data = { pointerId: 8 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  await save(h);
  const inner = h.getState().view.promptLibrary[0].children[0];
  assert.deepEqual(inner.children.map((n) => n.id), ['prompt-b', 'prompt-a', 'prompt-root'], 'selection appended inside in order');
  assert.equal(inner.children.length, 3);
  assert.equal(h.getState().view.promptLibrary[0].children.length, 1, 'prompt-a left its original parent');
});

test('pointer drag of an unselected row selects it first, then moves it inside a folder', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const src = h.rowFor('prompt-root');
  const target = h.rowFor('folder-dev');
  const data = { pointerId: 5 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  assert.ok(src.classList.contains('prompt-dragging'), 'dragged styling persists during dragover');
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  await save(h);
  const saved = h.getState().view.promptLibrary[0].children;
  assert.deepEqual(saved.map((n) => n.id), ['prompt-a', 'folder-inner', 'prompt-root'], 'moved inside folder');
  assert.equal(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-root'), false);
});

test('a folder cannot be dragged into its own descendant', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const toggle = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  toggle.dispatch('click', { target: toggle, preventDefault, stopPropagation });
  const src = h.rowFor('folder-dev');
  const target = h.rowFor('prompt-b');
  const data = { pointerId: 6 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  await save(h);
  assert.equal(h.getState().view.promptLibrary[0].id, 'folder-dev', 'cycle rejected');
  assert.equal(h.getState().view.promptLibrary.length, 2, 'no nodes lost');
});

test('Enter opens the focused prompt editor', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'Enter' });
  assert.ok(h.rowFor('prompt-root').querySelector('.prompt-card-title'), 'editor opened');
});

test('edits persist without a Save step and Close only shuts the dialog', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  // A structural change is persisted as soon as it is committed.
  h.nodes['prompt-add-folder'].dispatch('click', { preventDefault });
  await Promise.resolve();
  assert.equal(h.getState().view.promptLibrary.length, 3, 'added folder already saved');

  // A typing session persists when it ends, not per keystroke.
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'typed';
  textarea.dispatch('input', { target: textarea });
  assert.equal(h.getState().view.promptLibrary[1].text, 'three', 'not yet flushed mid-session');
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  await Promise.resolve();
  assert.equal(h.getState().view.promptLibrary[1].text, 'typed', 'Close flushes the open session');
  assert.equal(h.nodes['prompt-layer'].hidden, true, 'Close shuts the dialog');
});

test('reopening shows the auto-saved library, with no discard', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'Delete' });
  await Promise.resolve();
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  open(h);
  assert.equal(h.rowFor('prompt-root'), undefined, 'the delete survived closing and reopening');
});

test('a failed auto-save is surfaced and leaves the dialog open', async () => {
  let state = { groups: [], shortcuts: [], view: { promptLibrary: [{ id: 'prompt-x', type: 'prompt', title: 'X', text: 'body', includeInBatch: true }] } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => { throw new Error('disk full'); },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add-prompt', 'prompt-add-folder', 'prompt-tree-viewport', 'prompt-card-list',
    'prompt-root-surface', 'prompt-tree-menu', 'prompt-status',
    'prompt-error', 'prompt-cancel', 'prompt-copy-selected', 'copy-prompt',
    'prompt-delete-confirm', 'prompt-delete-message', 'prompt-delete-ok', 'prompt-delete-cancel',
    'prompt-page-prompts', 'prompt-page-hotkeys', 'prompt-tab-prompts', 'prompt-tab-hotkeys',
    'hotkey-list', 'hotkey-status', 'edge-opacity-slider', 'edge-opacity-value',
    'outline-opacity-slider', 'outline-opacity-value', 'region-opacity-slider', 'region-opacity-value', 'theme-select', 'transparent-background-toggle', 'hotkey-reset-all',
    'breadcrumb-root-scale-slider', 'breadcrumb-root-scale-value', 'breadcrumb-middle-scale-slider', 'breadcrumb-middle-scale-value',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  buildPromptLayerTree(nodes);
  nodes['prompt-layer'].hidden = true;
  nodes['prompt-status'].setAttribute('role', 'status');
  nodes['prompt-status'].setAttribute('aria-live', 'polite');

  const documentMock = {
    querySelector: (sel) => (sel.startsWith('#') ? nodes[sel.slice(1)] ?? null : nodes['prompt-layer'].querySelector(sel)),
    get activeElement() { return focusState.activeElement; },
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createDocumentFragment: () => { const f = makeNode('fragment'); f.isFragment = true; return f; },
    listeners: {},
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
    dispatch(type, event = {}) {
      const results = [];
      for (const entry of documentMock.listeners[type] || []) results.push(entry.fn(event));
      return results.length === 1 ? results[0] : Promise.all(results);
    },
  };
  const dialog = createPromptLibraryDialog({
    document: documentMock,
    store,
    fallbackPrompt: 'FALLBACK',
    copyText: () => Promise.resolve(),
    setStatus: () => {},
  });
  dialog.mount();
  dialog.open();
  // Adding a folder triggers an auto-save that rejects.
  nodes['prompt-add-folder'].dispatch('click', { preventDefault });
  // Let the store queue settle and the rejection propagate.
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  assert.equal(nodes['prompt-layer'].hidden, false, 'dialog stays open');
  assert.ok(nodes['prompt-error'].textContent.includes('disk full'), 'the failure is surfaced in the dialog');
});

test('Ctrl+C stores nodes internally without calling copyText', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'c', ctrlKey: true });
  assert.deepEqual(h.copied, [], 'no OS clipboard write');
  assert.ok(h.nodes['prompt-status'].textContent.includes('2 items copied'));
});

test('Ctrl+V duplicates copied nodes with recursively unique ids', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'c', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const saved = h.getState().view.promptLibrary;
  const ids = new Set();
  const walk = (list) => list.forEach((n) => { ids.add(n.id); if (n.type === 'folder') walk(n.children); });
  walk(saved);
  const count = [...ids].filter((id) => id.startsWith('prompt-') || id.startsWith('folder-')).length;
  assert.ok(count >= 6, 'originals and unique-id clones both present');
  assert.equal(ids.size, count, 'all ids unique across the tree');
});

test('Ctrl+X marks cut roots and Ctrl+V moves them atomically into a selected folder', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'x', ctrlKey: true });
  assert.ok(h.rowFor('prompt-root'), 'cut rows remain visible');
  assert.ok(h.rowFor('prompt-root').classList.contains('prompt-cut'));
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'v', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('1 item pasted'));
  await save(h);
  const children = h.getState().view.promptLibrary[0].children;
  assert.ok(children.some((n) => n.id === 'prompt-root'), 'cut prompt moved inside folder-dev');
  assert.equal(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-root'), false);
});

test('pasting a folder into its own descendant is rejected', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'x', ctrlKey: true });
  const toggle = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  toggle.dispatch('click', { target: toggle, preventDefault, stopPropagation });
  clickRow(h, 'prompt-b');
  keyOn(h, { key: 'v', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('cannot be moved inside itself'));
  await save(h);
  assert.equal(h.getState().view.promptLibrary[0].id, 'folder-dev', 'folder stayed at root');
});

test('editable controls keep native copy/cut/paste', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const input = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  input.dispatch('keydown', { target: input, key: 'c', ctrlKey: true, preventDefault, stopPropagation });
  assert.deepEqual(h.copied, [], 'no copy triggered from inside an editable control');
});

test('New prompt respects the exactly-one-selected-folder rule', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-inner');
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  await save(h);
  const inner = h.getState().view.promptLibrary[0].children[1];
  assert.equal(inner.children[inner.children.length - 1].type, 'prompt', 'added inside the selected folder');

  const h2 = createHarness({ initialView: treeFixture().view });
  open(h2);
  clickRow(h2, 'prompt-a');
  clickRow(h2, 'prompt-root', { ctrlKey: true });
  h2.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  await save(h2);
  const saved = h2.getState().view.promptLibrary;
  assert.equal(saved[saved.length - 1].type, 'prompt', 'multi-selection adds at root');
});

test('New folder adds at root and enters rename', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-folder'].dispatch('click', { preventDefault });
  const newFolder = h.folderRows().find((row) => row.querySelector('.prompt-folder-rename'));
  assert.ok(newFolder, 'new folder in rename mode');
  assert.equal(newFolder.dataset.parentId, '', 'added at root');
});

test('local status is live feedback and not the global workspace status', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.nodes['prompt-status'].getAttribute('role'), 'status');
  assert.equal(h.nodes['prompt-status'].getAttribute('aria-live'), 'polite');
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'x', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('1 item cut'));
  assert.deepEqual(h.statuses, [], 'global setStatus is never used for modal actions');
});

test('expanded prompt row carries the expanded styling class', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  assert.ok(h.rowFor('prompt-root').classList.contains('prompt-row-expanded'));
});

test('copying a folder pastes an independent cloned subtree', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'c', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('1 item copied'), 'folder copy allowed');
  blankClick(h);
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const saved = h.getState().view.promptLibrary;
  assert.ok(saved.length > 2, 'a folder clone was added at root');
  const clone = saved[saved.length - 1];
  assert.equal(clone.type, 'folder');
  assert.equal(clone.title, 'Dev');
  assert.notEqual(clone.id, 'folder-dev', 'the clone is an independent record');
  assert.equal(clone.children.length, 2, 'the whole subtree was copied');
});

test('prompt dialog use never changes workspace entity counts', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  const before = structuredClone(h.getState());
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'y', ctrlKey: true });
  openPrompt(h, 'prompt-root');
  const input = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  input.value = 'Renamed';
  input.dispatch('input', { target: input });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.deepEqual(h.getState(), before, 'workspace store untouched by prompt dialog activity');
});

test('destroy removes all listeners', () => {
  const h = createHarness();
  const before = h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0;
  assert.ok(before > 0);
  h.dialog.destroy();
  assert.equal(h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0, 0);
  assert.equal(h.nodes['prompt-card-list'].listeners.pointerup?.length ?? 0, 0);
});

// ===========================================================================
// Browser-level event routing regressions.
//
// These reproduce the two live Papers failures that the previous fake-DOM
// tests could not see: every keydown below is dispatched from the element
// that actually holds focus and bubbles through the real parent chain, and
// every root click lands on the real blank surface under the last row.
// ===========================================================================

const expandInner = (h) => {
  const toggle = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  toggle.dispatch('click', { target: toggle, preventDefault, stopPropagation });
};

test('Ctrl+Z from a selected row reaches local history', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  clickRow(h, 'prompt-root');
  assert.equal(h.document.activeElement, h.rowFor('prompt-root'), 'clicking a row focuses it');
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(h.promptRows().length, 2, 'undo ran from the focused row');
});

test('Ctrl+Z and Ctrl+Y reach local history from the New prompt button', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  assert.equal(h.promptRows().length, 3);
  // Focus the header button, outside the tree list entirely.
  keyFrom(h.nodes['prompt-add-prompt'], { key: 'z', ctrlKey: true });
  assert.equal(h.promptRows().length, 2, 'undo works from New prompt');
  keyFrom(h.nodes['prompt-add-prompt'], { key: 'y', ctrlKey: true });
  assert.equal(h.promptRows().length, 3, 'redo works from New prompt');
});

test('Ctrl+Z reaches local history from the Save and Cancel buttons', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  keyFrom(h.nodes['prompt-copy-selected'], { key: 'z', ctrlKey: true });
  assert.equal(h.promptRows().length, 2, 'undo works from Save');
  keyFrom(h.nodes['prompt-cancel'], { key: 'z', ctrlKey: true, shiftKey: true });
  assert.equal(h.promptRows().length, 3, 'Ctrl+Shift+Z redo works from Cancel');
});

test('Ctrl+Z from the New folder button and local status line works', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-folder'].dispatch('click', { preventDefault });
  const folders = h.folderRows().length;
  keyFrom(h.nodes['prompt-add-folder'], { key: 'z', ctrlKey: true });
  assert.equal(h.folderRows().length, folders - 1, 'undo works from New folder');
  keyFrom(h.nodes['prompt-status'], { key: 'y', ctrlKey: true });
  assert.equal(h.folderRows().length, folders, 'redo works from the local status line');
});

test('Ctrl+Z inside the prompt textarea stays native and leaves history alone', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  // Adding a prompt already opens its editor.
  const added = h.promptRows()[h.promptRows().length - 1].dataset.nodeId;
  const textarea = h.textareaFor(added);
  let prevented = false;
  textarea.dispatch('keydown', {
    target: textarea, key: 'z', ctrlKey: true,
    preventDefault: () => { prevented = true; }, stopPropagation,
  });
  assert.equal(prevented, false, 'native text undo is never prevented');
  assert.equal(h.promptRows().length, 3, 'tree history untouched from a textarea');
});

test('opening the dialog focuses the root surface, never document.body', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.document.activeElement, h.nodes['prompt-tree-viewport'], 'root viewport holds focus on open');
});

test('clicking blank root space focuses root and clears selection but keeps the clipboard', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickRow(h, 'prompt-b');
  keyOn(h, { key: 'c', ctrlKey: true });
  blankClick(h);
  assert.equal(h.document.activeElement, h.nodes['prompt-tree-viewport'], 'root surface takes focus');
  assert.equal(h.rowFor('prompt-b').getAttribute('aria-selected'), 'false', 'row selection cleared');
  keyOn(h, { key: 'v', ctrlKey: true });
  // Fixture has 2 top-level nodes; the surviving clipboard adds a third.
  assert.equal(h.rows().filter((r) => r.dataset.parentId === '').length, 3, 'clipboard survived and pasted at root');
});

test('copy a nested prompt, click real root surface, Ctrl+V clones at top level', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickRow(h, 'prompt-b');
  keyOn(h, { key: 'c', ctrlKey: true });
  blankClick(h);
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const roots = h.getState().view.promptLibrary;
  const clone = roots.find((n) => n.title === 'Beta');
  assert.ok(clone, 'clone landed at root');
  assert.notEqual(clone.id, 'prompt-b', 'clone has a regenerated id');
  const inner = roots[0].children.find((n) => n.id === 'folder-inner');
  assert.ok(inner.children.some((n) => n.id === 'prompt-b'), 'original stayed put');
});

test('cut a nested folder, click real root surface, Ctrl+V moves the subtree with original ids', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-inner');
  keyOn(h, { key: 'x', ctrlKey: true });
  blankClick(h);
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const roots = h.getState().view.promptLibrary;
  const moved = roots.find((n) => n.id === 'folder-inner');
  assert.ok(moved, 'folder moved to root with its original id');
  assert.equal(moved.children[0].id, 'prompt-b', 'subtree kept original child ids');
  assert.ok(!roots[0].children.some((n) => n.id === 'folder-inner'), 'removed from former parent');
});

test('copied folder pastes an independent clone at root', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-inner');
  keyOn(h, { key: 'c', ctrlKey: true });
  blankClick(h);
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const roots = h.getState().view.promptLibrary;
  const clone = roots.find((n) => n.type === 'folder' && n.title === 'Inner');
  assert.ok(clone, 'cloned folder at root');
  assert.notEqual(clone.id, 'folder-inner', 'folder id regenerated');
  assert.notEqual(clone.children[0].id, 'prompt-b', 'child ids regenerated');
  assert.equal(clone.children[0].title, 'Beta', 'titles preserved');
  assert.ok(roots[0].children.some((n) => n.id === 'folder-inner'), 'original untouched');
});

test('destination follows programmatic selection and repairs to root after undo', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'c', ctrlKey: true });
  // One selected folder -> paste inside it.
  clickRow(h, 'folder-inner');
  keyOn(h, { key: 'v', ctrlKey: true });
  assert.equal(
    h.rows().filter((r) => r.dataset.parentId === 'folder-inner').length, 2,
    'pasted inside the selected folder',
  );
  // Paste selects the new node; undo removes it, so destination must fall back
  // to root rather than pointing at a node that no longer exists.
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const roots = h.getState().view.promptLibrary;
  assert.equal(roots.filter((n) => n.title === 'Root').length, 2, 'destination repaired to root after undo');
});

test('a single selected prompt pastes after it in its own parent', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'c', ctrlKey: true });
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'v', ctrlKey: true });
  const siblings = h.rows().filter((r) => r.dataset.parentId === 'folder-dev').map((r) => r.dataset.nodeId);
  assert.equal(siblings[0], 'prompt-a', 'original first');
  assert.equal(siblings.length, 3, 'clone landed beside it inside folder-dev');
});

test('right-clicking blank root space clears selection, focuses root, and pastes at top level', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickRow(h, 'prompt-b');
  keyOn(h, { key: 'c', ctrlKey: true });
  const surface = h.nodes['prompt-root-surface'];
  surface.dispatch('contextmenu', { target: surface, clientX: 10, clientY: 10, preventDefault, stopPropagation });
  // Root is targeted and takes focus first; the menu then legitimately takes
  // focus for its own keyboard navigation, so focus ends up on the first item.
  assert.equal(h.rowFor('prompt-b').getAttribute('aria-selected'), 'false', 'selection cleared');
  assert.ok(
    h.nodes['prompt-tree-viewport'].classList.contains('prompt-root-target'),
    'root is the active destination',
  );
  const items = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]');
  const pasteRoot = items.find((b) => b.textContent === 'Paste at top level');
  assert.ok(pasteRoot, 'Paste at top level offered when the clipboard is populated');
  pasteRoot.dispatch('click', { target: pasteRoot, preventDefault, stopPropagation });
  await save(h);
  assert.ok(h.getState().view.promptLibrary.some((n) => n.title === 'Beta'), 'pasted at root');
});

test('prompt-tree shortcuts never escape to a document-level listener', () => {
  const h = createHarness({ initialView: treeFixture().view });
  const workspaceKeys = [];
  h.document.addEventListener('keydown', (event) => workspaceKeys.push(event.key));
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  blankClick(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'y', ctrlKey: true });
  assert.deepEqual(workspaceKeys, [], 'no prompt-tree shortcut escaped to a document listener');
});

test('deleting the focused row repairs selection and restores valid focus', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'Delete' });
  assert.equal(h.rowFor('prompt-a'), undefined, 'row removed');
  assert.ok(h.document.activeElement, 'focus is not left on nothing');
});

test('the root surface stays a clickable target with only a few rows', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const surface = h.nodes['prompt-root-surface'];
  assert.equal(surface.parentNode, h.nodes['prompt-tree-viewport'], 'surface lives inside the root target');
  assert.ok(!h.rows().some((r) => r.dataset.nodeId === undefined), 'no fake persisted root node was rendered');
  clickRow(h, 'prompt-a');
  surface.dispatch('click', { target: surface, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'clicking below the last row targets root');
});

// ===========================================================================
// Batch checkbox gestures: selection-driven bulk apply and Shift+click ranges.
// ===========================================================================

/** Clicks a row checkbox the way a browser does: click (carrying modifiers)
 * then change, with the new checked value already applied. */
const clickCheckbox = (h, id, { shiftKey = false } = {}) => {
  const box = h.rowFor(id).querySelector('.prompt-checkbox');
  box.checked = !box.checked;
  box.dispatch('click', { target: box, shiftKey, preventDefault, stopPropagation });
  box.dispatch('change', { target: box, shiftKey, preventDefault, stopPropagation });
  return box;
};
const checkedOf = (h, id) => h.rowFor(id).querySelector('.prompt-checkbox').checked;

test('checkbox click on a row inside the selection applies to every selected row', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  // Uncheck prompt-a first so the selection is genuinely mixed:
  // prompt-a false, prompt-b false, prompt-root true.
  clickCheckbox(h, 'prompt-a');
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-b', { ctrlKey: true });
  clickRow(h, 'prompt-root', { ctrlKey: true });
  // Checking prompt-b must force the entire mixed selection to checked.
  clickCheckbox(h, 'prompt-b');
  await save(h);
  const roots = h.getState().view.promptLibrary;
  const a = roots[0].children.find((n) => n.id === 'prompt-a');
  const b = roots[0].children.find((n) => n.id === 'folder-inner').children[0];
  const rootPrompt = roots.find((n) => n.id === 'prompt-root');
  assert.equal(b.includeInBatch, true, 'clicked row checked');
  assert.equal(a.includeInBatch, true, 'whole selection forced to the clicked value');
  assert.equal(rootPrompt.includeInBatch, true, 'whole selection forced to the clicked value');
});

test('unchecking inside a selection unchecks every selected row', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  // Both start included; unchecking one clears the whole selection.
  clickCheckbox(h, 'prompt-a');
  await save(h);
  const roots = h.getState().view.promptLibrary;
  assert.equal(roots[0].children.find((n) => n.id === 'prompt-a').includeInBatch, false);
  assert.equal(roots.find((n) => n.id === 'prompt-root').includeInBatch, false);
});

test('a bulk checkbox change is a single undo entry', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  clickCheckbox(h, 'prompt-a');
  assert.equal(checkedOf(h, 'prompt-a'), false);
  assert.equal(checkedOf(h, 'prompt-root'), false);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(checkedOf(h, 'prompt-a'), true, 'one undo restored both');
  assert.equal(checkedOf(h, 'prompt-root'), true, 'one undo restored both');
});

test('checkbox click outside the selection touches only that row', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  // prompt-b is not selected: clicking its box must not touch the selection.
  clickCheckbox(h, 'prompt-b');
  await save(h);
  const roots = h.getState().view.promptLibrary;
  const b = roots[0].children.find((n) => n.id === 'folder-inner').children[0];
  assert.equal(b.includeInBatch, true, 'clicked row changed');
  assert.equal(roots[0].children.find((n) => n.id === 'prompt-a').includeInBatch, true, 'unchanged');
  assert.equal(roots.find((n) => n.id === 'prompt-root').includeInBatch, true, 'unchanged');
});

test('checkbox clicks never change row selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickCheckbox(h, 'prompt-root');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true', 'selection preserved');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false', 'clicked box did not select');
});

test('Shift+click a checkbox applies its resulting state across the range', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  // Anchor on prompt-b (excluded -> checking it), then Shift+click folder-inner.
  // Visible order is folder-dev, prompt-a, folder-inner, prompt-b, prompt-root,
  // so the range is folder-inner..prompt-b and both take the CHECKED state the
  // shift-clicked box resolves to. Both start false, so only a working range
  // turns them true.
  clickCheckbox(h, 'prompt-b');
  assert.equal(checkedOf(h, 'prompt-b'), true);
  // Shift+click folder-dev, three rows above the anchor. The range is
  // folder-dev..prompt-b, so folder-dev AND folder-inner (neither previously
  // touched, both starting false) must become checked. Without a working
  // range only folder-dev would change.
  clickCheckbox(h, 'folder-dev', { shiftKey: true });
  await save(h);
  const roots = h.getState().view.promptLibrary;
  const dev = roots[0];
  const inner = dev.children.find((n) => n.id === 'folder-inner');
  assert.equal(dev.includeAll, true, 'shift-clicked row checked');
  assert.equal(inner.includeAll, true, 'range covered the intermediate folder');
  assert.equal(dev.children.find((n) => n.id === 'prompt-a').includeInBatch, true, 'range covered the intermediate prompt');
  assert.equal(inner.children[0].includeInBatch, true, 'anchor end of the range stayed checked');
  assert.equal(roots.find((n) => n.id === 'prompt-root').includeInBatch, true, 'below the range, untouched');
});

test('a Shift+click checkbox range is a single undo entry', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickCheckbox(h, 'prompt-b');
  clickCheckbox(h, 'folder-dev', { shiftKey: true });
  assert.equal(checkedOf(h, 'folder-inner'), true, 'range checked the intermediate folder');
  assert.equal(checkedOf(h, 'folder-dev'), true, 'range checked the far end');
  blankClick(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(checkedOf(h, 'folder-inner'), false, 'one undo reversed the whole range');
  assert.equal(checkedOf(h, 'folder-dev'), false, 'one undo reversed the whole range');
  assert.equal(checkedOf(h, 'prompt-b'), true, 'only the range step was undone');
});

test('Shift+click checkbox range does not select rows', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickCheckbox(h, 'prompt-b');
  clickCheckbox(h, 'folder-dev', { shiftKey: true });
  for (const id of ['prompt-a', 'prompt-b', 'prompt-root']) {
    assert.equal(h.rowFor(id).getAttribute('aria-selected'), 'false', id + ' not selected by a checkbox range');
  }
});

test('Shift+click without a prior checkbox anchor toggles only that row', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickCheckbox(h, 'prompt-root', { shiftKey: true });
  await save(h);
  const roots = h.getState().view.promptLibrary;
  assert.equal(roots.find((n) => n.id === 'prompt-root').includeInBatch, false, 'clicked row toggled');
  assert.equal(roots[0].children.find((n) => n.id === 'prompt-a').includeInBatch, true, 'nothing else touched');
});

// ===========================================================================
// Folder exclude-all: the third batch state.
// ===========================================================================

const folderBox = (h, id) => h.rowFor(id).querySelector('.prompt-checkbox');
const cycleFolder = (h, id) => {
  const box = folderBox(h, id);
  box.dispatch('click', { target: box, preventDefault, stopPropagation });
};

test('the folder checkbox cycles neutral, include, exclude, neutral', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'neutral', 'starts neutral');
  cycleFolder(h, 'folder-dev');
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'include');
  cycleFolder(h, 'folder-dev');
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'exclude');
  cycleFolder(h, 'folder-dev');
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'neutral', 'cycles back');
});

test('the exclude state renders as an indeterminate box, not a check', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-dev');
  const box = folderBox(h, 'folder-dev');
  assert.equal(box.checked, false, 'exclude is not a check');
  assert.equal(box.indeterminate, true, 'exclude renders indeterminate');
  assert.ok(box.getAttribute('aria-label').startsWith('Exclude'), 'label says exclude');
});

test('excluding a folder drops its checked prompts from the batch', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  // prompt-a inside folder-dev is checked; prompt-root at top level is checked.
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-dev');
  await save(h);
  console.log('STORE:', JSON.stringify(h.getState().view.promptLibrary[0]));
  const text = h.dialog.getBatchText();
  console.log('TEXT:', JSON.stringify(text));
  assert.ok(!text.includes('one'), 'checked child inside an excluded folder is dropped');
  assert.ok(text.includes('three'), 'prompts outside the folder are unaffected');
});

test('excluding a folder leaves child checkboxes intact for when it is cleared', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-dev');
  await save(h);
  const dev = h.getState().view.promptLibrary[0];
  assert.equal(dev.excludeAll, true, 'folder stores the exclude override');
  assert.equal(
    dev.children.find((n) => n.id === 'prompt-a').includeInBatch, true,
    'child checkbox preserved, never rewritten',
  );
  // Clearing the override restores the previous batch exactly.
  cycleFolder(h, 'folder-dev');
  await save(h);
  assert.ok(h.dialog.getBatchText().includes('one'), 'child returns to the batch');
});

test('the nearest folder override wins over an outer one', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  // Include everything under folder-dev, then exclude the nested folder.
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-inner');
  cycleFolder(h, 'folder-inner');
  await save(h);
  const text = h.dialog.getBatchText();
  assert.ok(text.includes('one'), 'outer include still applies to its own children');
  assert.ok(!text.includes('two'), 'inner exclude overrides the outer include');
});

test('an included folder inside an excluded one copies everything again', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-inner');
  await save(h);
  const text = h.dialog.getBatchText();
  assert.ok(!text.includes('one'), 'outer exclude still applies');
  assert.ok(text.includes('two'), 'inner include overrides the outer exclude');
});

test('rows under a non-neutral folder are marked as overridden', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  assert.ok(!h.rowFor('prompt-a').classList.contains('prompt-batch-forced'), 'neutral marks nothing');
  cycleFolder(h, 'folder-dev');
  assert.equal(h.rowFor('prompt-a').dataset.batchForced, 'include', 'descendant marked include');
  assert.equal(h.rowFor('folder-inner').dataset.batchForced, 'include', 'nested folder marked too');
  assert.equal(h.rowFor('prompt-b').dataset.batchForced, 'include', 'deep descendant marked');
  assert.ok(!h.rowFor('prompt-root').classList.contains('prompt-batch-forced'), 'siblings unaffected');
  cycleFolder(h, 'folder-dev');
  assert.equal(h.rowFor('prompt-a').dataset.batchForced, 'exclude', 'descendant marked exclude');
});

test('a folder batch cycle is one undo entry', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  cycleFolder(h, 'folder-dev');
  cycleFolder(h, 'folder-dev');
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'exclude');
  blankClick(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'include', 'one undo steps back one state');
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'neutral');
});

test('the folder context menu offers the two states it is not in', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const row = h.rowFor('folder-dev');
  row.dispatch('contextmenu', { target: row, clientX: 5, clientY: 5, preventDefault, stopPropagation });
  const labels = () => h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.ok(labels().includes('Include everything inside'));
  assert.ok(labels().includes('Exclude everything inside'));
  assert.ok(!labels().includes('Use child selections'), 'neutral folder does not offer neutral');
});

test('the context menu can put a folder into exclude and back to neutral', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const openMenu = () => {
    const row = h.rowFor('folder-dev');
    row.dispatch('contextmenu', { target: row, clientX: 5, clientY: 5, preventDefault, stopPropagation });
    return h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]');
  };
  let item = openMenu().find((b) => b.textContent === 'Exclude everything inside');
  item.dispatch('click', { target: item, preventDefault, stopPropagation });
  assert.equal(folderBox(h, 'folder-dev').dataset.batchState, 'exclude');
  item = openMenu().find((b) => b.textContent === 'Use child selections');
  assert.ok(item, 'a non-neutral folder offers neutral');
  item.dispatch('click', { target: item, preventDefault, stopPropagation });
  await save(h);
  const dev = h.getState().view.promptLibrary[0];
  assert.equal(dev.includeAll, false, 'neutral clears include');
  assert.equal(dev.excludeAll, false, 'neutral also clears exclude, never stranding the folder');
});

// ===========================================================================
// Copy selected: copies the highlighted rows, independent of the batch checkboxes.
// The checkboxes drive the quick copy from outside the dialog; this button
// copies what is selected in the tree.
// ===========================================================================

const copySelected = (h) => h.nodes['prompt-copy-selected'].dispatch('click', { preventDefault, stopPropagation });

test('Copy selected is disabled until rows are selected', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.nodes['prompt-copy-selected'].disabled, true, 'disabled with no selection');
  clickRow(h, 'prompt-root');
  assert.equal(h.nodes['prompt-copy-selected'].disabled, false, 'enabled once something is selected');
  blankClick(h);
  assert.equal(h.nodes['prompt-copy-selected'].disabled, true, 'disabled again when selection clears');
});

test('Copy selected copies a selected prompt regardless of its checkbox', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  // prompt-b is excluded from the batch; selecting it must still copy it.
  clickRow(h, 'prompt-b');
  copySelected(h);
  assert.deepEqual(h.copied, ['two'], 'unchecked prompt still copied when selected');
});

test('Copy selected copies every prompt inside a selected folder, children unselected', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  // folder-dev is neutral and prompt-b inside it is unchecked; selecting the
  // folder alone must still copy everything it contains.
  clickRow(h, 'folder-dev');
  copySelected(h);
  assert.deepEqual(h.copied, ['one\n\ntwo'], 'whole folder subtree copied in visual order');
});

test('Copy selected does not duplicate a prompt selected under a selected folder', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  expandInner(h);
  clickRow(h, 'folder-dev');
  clickRow(h, 'prompt-a', { ctrlKey: true });
  copySelected(h);
  assert.deepEqual(h.copied, ['one\n\ntwo'], 'root reduction stops the double copy');
});

test('Copy selected joins multiple selected roots in visual order', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  clickRow(h, 'folder-dev', { ctrlKey: true });
  copySelected(h);
  assert.deepEqual(h.copied, ['one\n\ntwo\n\nthree'], 'depth-first visual order, not click order');
});

test('Copy selected ignores folder exclude-all overrides', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const box = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  box.dispatch('click', { target: box, preventDefault, stopPropagation });
  box.dispatch('click', { target: box, preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').dataset.batchState, 'exclude');
  clickRow(h, 'folder-dev');
  copySelected(h);
  assert.deepEqual(h.copied, ['one\n\ntwo'], 'an explicit selection copies even an excluded folder');
});

test('Copy selected reports when the selection has no prompt text', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-folder'].dispatch('click', { preventDefault });
  const empty = h.folderRows()[h.folderRows().length - 1].dataset.nodeId;
  blankClick(h);
  clickRow(h, empty);
  copySelected(h);
  assert.deepEqual(h.copied, [], 'nothing sent to the clipboard');
  assert.ok(h.nodes['prompt-status'].textContent.includes('Nothing to copy'));
});

test('Copy selected does not touch the draft, history, or the workspace store', () => {
  const h = createHarness({ initialView: treeFixture().view });
  const before = JSON.parse(JSON.stringify(h.getState()));
  open(h);
  clickRow(h, 'folder-dev');
  copySelected(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('Nothing to undo'), 'copying is not an undoable edit');
  assert.deepEqual(h.getState(), before, 'workspace store untouched');
});

// ===========================================================================
// Copy confirmation: the button flashes green and names what was copied.
// ===========================================================================

test('copying flashes the button and annotates what was copied', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  assert.deepEqual(h.copied, ['three'], 'text reached the clipboard');
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copied 1 prompt', 'singular annotation');
  assert.ok(
    h.nodes['prompt-copy-selected'].classList.contains('prompt-copied-flash'),
    'the button flashes',
  );
});

test('the annotation counts prompts copied, not rows selected', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  // One selected folder contributes two prompts.
  clickRow(h, 'folder-dev');
  copySelected(h);
  await Promise.resolve();
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copied 2 prompts', 'plural, counted from the text');
});

test('the confirmation restores the button label', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copied 1 prompt');
  assert.ok(h.nodes['prompt-status'].classList.contains('prompt-status-copied'));
  await new Promise((resolve) => setTimeout(resolve, 2900));
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copied 1 prompt', 'confirmation stays for three seconds');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copy selected', 'label restored');
  assert.equal(h.nodes['prompt-status'].textContent, '', 'copy notification cleared');
  assert.ok(
    !h.nodes['prompt-copy-selected'].classList.contains('prompt-copied-flash'),
    'flash class removed',
  );
});

test('a second copy restarts the confirmation instead of stranding the label', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  // Second copy lands most of the way through the first confirmation. If the
  // first timer is not cancelled it fires mid-second-confirmation and clears
  // the label early.
  await new Promise((resolve) => setTimeout(resolve, 2700));
  clickRow(h, 'folder-dev');
  copySelected(h);
  await Promise.resolve();
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copied 2 prompts', 'second copy wins');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(
    h.nodes['prompt-copy-selected'].textContent, 'Copied 2 prompts',
    'the first timer must not cut the second confirmation short',
  );
  await new Promise((resolve) => setTimeout(resolve, 2700));
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copy selected', 'restored once');
  assert.equal(h.nodes['prompt-status'].textContent, '', 'second notification owns the restarted deadline');
});

test('closing during a confirmation restores the label immediately', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copy selected', 'not left on the confirmation');
  assert.ok(!h.nodes['prompt-copy-selected'].classList.contains('prompt-copied-flash'));
});

test('a failed copy reports the error and does not flash success', async () => {
  const h = createHarness({ initialView: treeFixture().view, copyFails: true });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.nodes['prompt-copy-selected'].textContent, 'Copy selected', 'no success annotation');
  assert.ok(!h.nodes['prompt-copy-selected'].classList.contains('prompt-copied-flash'), 'no flash');
  assert.ok(h.nodes['prompt-error'].textContent.includes('clipboard blocked'), 'the failure is surfaced');
});

test('a copy confirmation renders as a notification, other statuses do not', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  assert.equal(h.nodes['prompt-status'].textContent, 'Copied 1 prompt.');
  assert.ok(
    h.nodes['prompt-status'].classList.contains('prompt-status-copied'),
    'the copy confirmation is emphasized',
  );
  // An ordinary status must drop the notification treatment.
  keyOn(h, { key: 'c', ctrlKey: true });
  assert.ok(
    !h.nodes['prompt-status'].classList.contains('prompt-status-copied'),
    'a later plain status clears the emphasis',
  );
});

test('reopening the dialog clears a previous copy notification', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  copySelected(h);
  await Promise.resolve();
  assert.ok(h.nodes['prompt-status'].classList.contains('prompt-status-copied'));
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.ok(
    !h.nodes['prompt-status'].classList.contains('prompt-status-copied'),
    'closing clears it',
  );
  open(h);
  assert.equal(h.nodes['prompt-status'].textContent, '', 'reopens clean');
  assert.ok(!h.nodes['prompt-status'].classList.contains('prompt-status-copied'));
});
