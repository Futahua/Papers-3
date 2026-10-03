import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorDialog } from './public/app/components/editor-dialog.js';

function fakeNode() {
  return {
    hidden: null,
    textContent: '',
    value: '',
    disabled: false,
    readOnly: false,
    placeholder: '',
    innerHTML: '',
    files: [],
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    classList: { add() {}, remove() {} },
    src: '',
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
    focus() {},
  };
}

function createHarness({ host = {} } = {}) {
  const nodes = {};
  for (const key of [
    'editorTitle', 'name', 'description', 'descriptionLabel', 'target',
    'targetFields', 'targetActions', 'iconInput', 'iconPreview',
    'iconFallback', 'iconDefaultButton', 'editorError', 'editorLayer',
    'saveButton', 'linkEditLayer', 'editor', 'target-input', 'pickFile',
  ]) {
    nodes[key] = fakeNode();
  }
  nodes['target-input'] = nodes.target;
  nodes['icon-input'] = nodes.iconInput;
  nodes['icon-preview'] = nodes.iconPreview;
  nodes['icon-fallback'] = nodes.iconFallback;
  nodes['use-target-icon'] = nodes.iconDefaultButton;

  const committed = [];
  const rendered = [];
  const iconCache = new Map();
  let state = { groups: [], shortcuts: [] };
  let currentId = 'root';
  let closed = 0;
  let lastCreated = null;

  const model = {
    createGroup(s, name, parentId, icon) {
      const group = { id: 'g-new', parentId, name, icon: icon ?? null };
      lastCreated = { kind: 'group', group };
      return { ...s, groups: [...s.groups, group] };
    },
    updateGroup: (s, id, changes) => s,
    createShortcut: (s, { name, parentId, icon }) => {
      const shortcut = { id: 's-new', name, target: '', icon: icon ?? null, placements: [{ id: 'p1', parentId }] };
      lastCreated = { kind: 'shortcut', shortcut };
      return { ...s, shortcuts: [...s.shortcuts, shortcut] };
    },
    updateShortcut: (s, id, changes) => s,
    createWebLink: (s, input) => s,
    updateWebLink: (s, id, changes) => s,
    forkPlacement: (s) => s,
    placementCount: () => 1,
    shortcut: (id) => state.shortcuts.find((c) => c.id === id) ?? null,
    isWebLink: (candidate) => candidate?.target?.startsWith('https://'),
    anyActivePlacementId: () => null,
    visiblePlacementIdFor: () => null,
  };

  const editor = createEditorDialog({
    elements: nodes,
    document: {
      querySelector(sel) {
        if (sel === '.icon-choice') return nodes.editor;
        const key = sel.replace(/^#/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return nodes[key] ?? fakeNode();
      },
    },
    getState: () => state,
    getCurrentId: () => currentId,
    closeMenu: () => { closed += 1; },
    host: { pickTarget: async () => null, shortcutIcon: async () => 'data:icon', ...host },
    iconCache,
    compressIconFile: async (file) => `data:${file.name}`,
    hydrateWebPreview: async () => {},
    commit: async (next, message) => { committed.push({ next, message }); return true; },
    render: () => { rendered.push(true); },
    ...model,
  });

  return {
    editor, nodes, committed, rendered, iconCache,
    setState: (next) => { state = next; },
    getState: () => state,
    setCurrentId: (id) => { currentId = id; },
    getLastCreated: () => lastCreated,
    getClosed: () => closed,
  };
}

test('showEditor for a new group titles the dialog and hides target fields', () => {
  const h = createHarness();
  h.editor.showEditor('group', null, 'parent-1');
  assert.equal(h.nodes.editorTitle.textContent, 'New folder');
  assert.equal(h.nodes.descriptionLabel.hidden, true);
  assert.equal(h.nodes.targetFields.hidden, true);
  assert.equal(h.nodes.editorLayer.hidden, false);
  assert.equal(h.getClosed(), 1);
});

test('showEditor for an existing shortcut fills the form and uses cached icon', () => {
  const h = createHarness();
  const record = {
    id: 's1', name: 'CAD', description: 'desc', target: 'C:\\acad.exe', icon: null,
  };
  h.iconCache.set('s1', 'data:cached-icon');
  h.editor.showEditor('shortcut', record, 'parent-1');
  assert.equal(h.nodes.editorTitle.textContent, 'Edit shortcut');
  assert.equal(h.nodes.name.value, 'CAD');
  assert.equal(h.nodes.description.value, 'desc');
  assert.equal(h.nodes.target.value, 'C:\\acad.exe');
});

test('saving a new group commits createGroup and closes the editor', async () => {
  const h = createHarness();
  h.editor.showEditor('group', null, 'parent-1');
  h.nodes.name.value = 'Things';
  await h.editor.saveEditor();
  assert.equal(h.getLastCreated().kind, 'group');
  assert.equal(h.getLastCreated().group.name, 'Things');
  assert.equal(h.committed.length, 1);
  assert.equal(h.nodes.editorLayer.hidden, true);
});

test('saving a new shortcut commits createShortcut', async () => {
  const h = createHarness();
  h.editor.showEditor('shortcut', null, 'parent-1');
  h.nodes.name.value = 'App';
  await h.editor.saveEditor();
  assert.equal(h.getLastCreated().kind, 'shortcut');
  assert.equal(h.getLastCreated().shortcut.name, 'App');
  assert.equal(h.committed.length, 1);
});

test('a new shortcut defaults to the picked target icon', async () => {
  const h = createHarness({
    host: {
      pickTarget: async () => ({ target: 'C:\\app.exe', icon: 'data:target-icon' }),
    },
  });
  h.editor.mount();
  h.editor.showEditor('shortcut', null, 'parent-1');
  h.nodes.name.value = 'App';
  // Simulate the creator picking the target through the Choose file/app button;
  // that sets the resolved target icon as the editor's target icon. The pick
  // handler is async, so let it settle before saving.
  h.nodes.pickFile._dispatch('click', {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  await h.editor.saveEditor();
  assert.equal(h.getLastCreated().kind, 'shortcut');
  assert.equal(h.getLastCreated().shortcut.icon, 'data:target-icon');
});

test('destroy removes the submit and save listeners', () => {
  const h = createHarness();
  h.editor.mount();
  const before = h.nodes.editor._listeners.length + h.nodes.saveButton._listeners.length;
  assert.ok(before > 0);
  h.editor.destroy();
  const after = h.nodes.editor._listeners.length + h.nodes.saveButton._listeners.length;
  assert.equal(after, 0);
});
