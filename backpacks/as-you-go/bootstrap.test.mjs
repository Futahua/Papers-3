import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapWorkspace } from './public/app/bootstrap.js';

function fakeComponent() {
  return {
    mounted: 0,
    mount() { this.mounted += 1; },
    destroy() {},
  };
}

function createHarness({ loadWorkspace }) {
  const calls = [];
  const toolbar = fakeComponent();
  const confirmDialog = fakeComponent();
  const menu = fakeComponent();
  const editorDialog = fakeComponent();
  const binControls = fakeComponent();
  const keyboard = fakeComponent();
  const drop = fakeComponent();
  const pointer = fakeComponent();
  const promptLibrary = fakeComponent();
  let state = null;
  let status = null;
  let rendered = 0;

  const promise = bootstrapWorkspace({
    loadState: async () => loadWorkspace(),
    setState: (next) => { state = next; calls.push('setState'); },
    restoreWorkspaceView: () => { calls.push('restoreWorkspaceView'); },
    setStatus: (text) => { status = text; calls.push('setStatus'); },
    render: () => { rendered += 1; calls.push('render'); },
    toolbar,
    confirmDialog,
    menu,
    editorDialog,
    binControls,
    keyboard,
    drop,
    pointer,
    promptLibrary,
  });

  return {
    promise, calls, toolbar, confirmDialog, menu, editorDialog, binControls, keyboard, drop, pointer, promptLibrary,
    getState: () => state,
    getStatus: () => status,
    getRendered: () => rendered,
  };
}

test('behavior components mount synchronously even before loading resolves', () => {
  const h = createHarness({ loadWorkspace: () => new Promise(() => {}) });
  // The synchronous mounts must have happened before any async settling.
  assert.equal(h.confirmDialog.mounted, 1);
  assert.equal(h.menu.mounted, 1);
  assert.equal(h.editorDialog.mounted, 1);
  assert.equal(h.binControls.mounted, 1);
  assert.equal(h.keyboard.mounted, 1);
  assert.equal(h.drop.mounted, 1);
  assert.equal(h.pointer.mounted, 1);
  assert.equal(h.promptLibrary.mounted, 1);
});

test('when loading rejects, the fallback still renders and components stay wired', async () => {
  const h = createHarness({ loadWorkspace: () => { throw new Error('load failed'); } });
  await h.promise;

  assert.equal(h.getStatus(), 'load failed');
  assert.equal(h.getRendered(), 1);
  assert.equal(h.confirmDialog.mounted, 1);
  assert.equal(h.menu.mounted, 1);
  assert.equal(h.editorDialog.mounted, 1);
  assert.equal(h.binControls.mounted, 1);
  assert.equal(h.keyboard.mounted, 1);
  // The toolbar restores saved positions, so it only mounts after a
  // successful load and is skipped on the failure path.
  assert.equal(h.toolbar.mounted, 0);
  assert.equal(h.getState(), null);
});

test('when loading succeeds, state is restored and the toolbar mounts', async () => {
  const h = createHarness({ loadWorkspace: () => ({ groups: [], shortcuts: [] }) });
  await h.promise;

  assert.equal(h.getStatus(), null);
  assert.equal(h.getRendered(), 1);
  assert.deepEqual(h.getState(), { groups: [], shortcuts: [] });
  assert.equal(h.toolbar.mounted, 1);
  assert.ok(h.calls.includes('restoreWorkspaceView'));
});

