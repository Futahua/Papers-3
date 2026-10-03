import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHostBridge } from './public/app/host/host-bridge.js';

/** Builds a minimal fake window whose parent postMessage is captured and
 * whose message listener can be driven by the test. */
function createMockWindow() {
  const listeners = new Map();
  const parent = {
    messages: [],
    postMessage(message, targetOrigin) {
      parent.messages.push({ message, targetOrigin });
    },
  };
  return {
    parent,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchMessage(data, source = parent) {
      for (const handler of listeners.get('message') ?? []) {
        handler({ source, data });
      }
    },
  };
}

test('host bridge posts the protocol request and resolves a plain state response', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.loadWorkspace();
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:as-you-go-load');
  assert.ok(sent.requestId);

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    state: { hello: 'world' },
  });
  assert.deepEqual(await promise, { hello: 'world' });
});

test('command-surface dismissal carries the explicit destination to Papers', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.dismissCommandSurface({ destination: 'papers' });
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:command-surface-dismiss');
  assert.equal(sent.destination, 'papers');
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true });
  await promise;
});

test('host bridge rejects when the host reports an error', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.saveWorkspace('{ "snapshot": true }');
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:as-you-go-save');
  assert.deepEqual(sent.state, '{ "snapshot": true }');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: false,
    error: 'disk full',
  });
  await assert.rejects(promise, /disk full/);
});

test('host bridge reversibly wraps an unresolved shortcut so one bad target cannot block saving', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const state = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [
      { id: 'valid', target: 'C:\\Apps\\valid.exe' },
      { id: 'unresolved', target: 'relative.cmd' },
    ],
  };

  const savePromise = host.saveWorkspace(JSON.stringify(state));
  const saveRequest = mock.parent.messages[0].message;
  const saved = JSON.parse(saveRequest.state);
  assert.equal(saved.shortcuts[0].target, 'C:\\Apps\\valid.exe');
  assert.equal(
    saved.shortcuts[1].target,
    'https://invalid.invalid/as-you-go/unresolved-shortcut',
  );
  assert.deepEqual(saved.shortcuts[1].__asYouGoUnresolvedTarget, {
    version: 1,
    target: 'relative.cmd',
  });
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: saveRequest.requestId,
    ok: true,
  });
  await savePromise;

  const loadPromise = host.loadWorkspace();
  const loadRequest = mock.parent.messages[1].message;
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: loadRequest.requestId,
    ok: true,
    state: JSON.stringify(saved),
  });
  assert.deepEqual(JSON.parse(await loadPromise), state);
});

test('host bridge never revives stale unresolved metadata after a target is repaired', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const state = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [{
      id: 'repaired',
      target: 'https://example.com',
      __asYouGoUnresolvedTarget: { version: 1, target: 'old-relative.cmd' },
    }],
  };

  const promise = host.saveWorkspace(JSON.stringify(state));
  const sent = mock.parent.messages[0].message;
  const saved = JSON.parse(sent.state);
  assert.equal(saved.shortcuts[0].target, 'https://example.com');
  assert.equal('__asYouGoUnresolvedTarget' in saved.shortcuts[0], false);
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
  });
  await promise;
});

test('host bridge unwraps the target+icon shape used by target picking', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.pickTarget('file');
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:as-you-go-pick-target');
  assert.equal(sent.kind, 'file');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    target: 'C:\\thing.txt',
    icon: 'data:image/png;base64,xx',
  });
  assert.deepEqual(await promise, {
    target: 'C:\\thing.txt',
    icon: 'data:image/png;base64,xx',
  });
});

test('host bridge routes the shared file capability and unwraps its typed result', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.fileCapability('search', { query: 'draft', limit: 25 });
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:file-capability');
  assert.equal(sent.operation, 'search');
  assert.deepEqual(sent.params, { query: 'draft', limit: 25 });

  const fileCapability = {
    ok: true,
    provider: 'everything',
    total: 1,
    results: [{ path: 'D:\\draft.txt', name: 'draft.txt', kind: 'file' }],
  };
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    fileCapability,
  });
  assert.deepEqual(await promise, fileCapability);
});

test('host bridge sends dropped files flat and unwraps the returned targets array', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const droppedFiles = [{ name: 'a.txt' }, { name: 'b.png' }];
  const promise = host.resolveDroppedTargets(droppedFiles);
  const sent = mock.parent.messages[0].message;

  // Regression: the outbound payload must be { files: droppedFiles }, never
  // { files: { files: droppedFiles } }.
  assert.equal(sent.type, 'papers:project:resolve-dropped-targets');
  assert.deepEqual(sent.files, droppedFiles);

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    targets: [
      { kind: 'file', target: 'D:\\a.txt', name: 'a' },
      { kind: 'web', target: 'https://example.com', name: 'example' },
    ],
  });
  assert.deepEqual(await promise, [
    { kind: 'file', target: 'D:\\a.txt', name: 'a' },
    { kind: 'web', target: 'https://example.com', name: 'example' },
  ]);
});

test('host bridge unwraps the finalOrigin shape used for dropped images', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.resolveDroppedTargets([{ name: 'x.png' }]);
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:resolve-dropped-targets');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    icon: 'data:image/png;base64,yy',
    mime: 'image/png',
    finalOrigin: 'D:\\x.png',
    title: 'x.png',
  });
  assert.deepEqual(await promise, {
    icon: 'data:image/png;base64,yy',
    mime: 'image/png',
    finalOrigin: 'D:\\x.png',
    title: 'x.png',
  });
});

test('host bridge ignores messages that do not come from the parent frame', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.copyText('hello');
  const sent = mock.parent.messages[0].message;

  let settled = false;
  promise.then(() => { settled = true; });

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    target: 'should be ignored',
  }, { /* not the parent frame */ });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    target: 'clips',
  });
  assert.equal(await promise, 'clips');
});

test('host bridge window candidate methods post the enumerated protocol and unwrap shapes', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const candidatesPromise = host.windowCandidates();
  const sentList = mock.parent.messages[0].message;
  assert.equal(sentList.type, 'papers:project:window-candidates');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentList.requestId, ok: true,
    outcome: 'success',
    candidates: [{ id: 'c1', title: 'Window A', processId: 1001, processPath: 'p', icon: 'data:icon', state: 'normal' }],
  });
  assert.deepEqual(await candidatesPromise, {
    outcome: 'success',
    candidates: [{ id: 'c1', title: 'Window A', processId: 1001, processPath: 'p', icon: 'data:icon', state: 'normal' }],
    error: null,
  });

  const bindPromise = host.bindWindowCandidate('c1');
  const sentBind = mock.parent.messages[1].message;
  assert.equal(sentBind.type, 'papers:project:window-bind-candidate');
  assert.equal(sentBind.candidateId, 'c1');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentBind.requestId, ok: true,
    outcome: 'success',
    capability: { version: 1, runtimeToken: 'Ta', title: 'Window A', processId: 1001 },
    descriptor: { version: 1, title: 'Window A', processId: 1001 },
  });
  assert.deepEqual(await bindPromise, {
    outcome: 'success',
    capability: { version: 1, runtimeToken: 'Ta', title: 'Window A', processId: 1001 },
    descriptor: { version: 1, title: 'Window A', processId: 1001 },
    observation: null,
    error: null,
  });

  const picker = host.windowCandidatePicker([], 'picker-1');
  const sentPicker = mock.parent.messages[2].message;
  assert.equal(sentPicker.type, 'papers:project:window-candidate-picker');
  assert.deepEqual(sentPicker.candidates, []);
  assert.equal(sentPicker.pickerId, 'picker-1');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentPicker.requestId, ok: true,
    picker: { action: 'remove', candidateId: 'c1' },
  });
  assert.deepEqual(await picker, { action: 'remove', candidateId: 'c1' });

  const directPicker = host.windowCandidatePicker([{ id: 'c1', title: 'Window A', icon: null, current: false }], 'picker-2');
  const sentDirectPicker = mock.parent.messages[3].message;
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentDirectPicker.requestId, ok: true,
    picker: { action: 'direct-pick', candidateId: null },
  });
  assert.deepEqual(await directPicker, { action: 'direct-pick', candidateId: null });

  const update = host.windowCandidatePickerUpdate([{ id: 'c1', title: 'Window A', icon: null, current: false }], 'picker-1');
  const sentUpdate = mock.parent.messages[4].message;
  assert.equal(sentUpdate.type, 'papers:project:window-candidate-picker-update');
  assert.equal(sentUpdate.pickerId, 'picker-1');
  assert.equal(sentUpdate.candidates[0].id, 'c1');
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sentUpdate.requestId, ok: true, outcome: 'success', delivery: 'applied' });
  assert.deepEqual(await update, { outcome: 'success', delivery: 'applied' });

  const closePicker = host.windowCandidatePickerClose();
  const sentClosePicker = mock.parent.messages[5].message;
  assert.equal(sentClosePicker.type, 'papers:project:window-candidate-picker-close');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentClosePicker.requestId, ok: true,
    picker: { ok: true },
  });
  assert.deepEqual(await closePicker, { action: 'cancel', candidateId: null });

});

test('host bridge preserves the lifecycle snapshot payload instead of dropping it with the outcome', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const pending = host.windowLifecycleSnapshot();
  const sent = mock.parent.messages[0].message;
  const snapshot = { complete: false, windows: [{ windowInstanceId: 'W0000000000000001' }] };
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: true,
    outcome: 'success', snapshot,
  });
  assert.deepEqual(await pending, { outcome: 'success', snapshot, error: null });
});

test('host bridge surfaces bounded Quick Run host detail instead of a generic error', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const promise = host.widgetQuickRunInput('start', 'agh');
  const sent = mock.parent.messages[0].message;
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: false,
    detail: 'Quick Run could not open from this widget because no host window is available.',
  });
  await assert.rejects(promise, /Quick Run could not open from this widget/);
});

test('candidate picker update keeps typed buffered, stale, and failed receipts', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  for (const [outcome, delivery] of [['success', 'buffered'], ['stale', undefined], ['failed', undefined]]) {
    const answer = host.windowCandidatePickerUpdate([], 'picker-1');
    const request = mock.parent.messages.at(-1).message;
    mock.dispatchMessage({ type: 'papers:host:result', requestId: request.requestId, ok: true, outcome, ...(delivery ? { delivery } : {}) });
    assert.deepEqual(await answer, { outcome, ...(delivery ? { delivery } : {}) });
  }
});

test('direct-pick begin has its own bounded startup timeout instead of the short RPC or human chooser timeout', async () => {
  const source = await readFile(new URL('./public/app/host/host-bridge.js', import.meta.url), 'utf8');
  assert.match(source, /const PICK_BEGIN_REQUEST_TIMEOUT_MS = 30 \* 1000;/,
    'native picker setup gets enough time for the helper retry plus activation ACK');
  assert.match(
    source,
    /pickWindowBegin: \(members\) =>[\s\S]*?request\('papers:project:window-pick-begin', \{ members \}, PICK_BEGIN_REQUEST_TIMEOUT_MS\)/,
    'direct-pick begin uses the dedicated bounded setup timeout');
  assert.match(
    source,
    /windowCandidatePicker: \(candidates, pickerId\) =>[\s\S]*?INTERACTIVE_REQUEST_TIMEOUT_MS/,
    'the human-search chooser keeps its separate interactive timeout');
});

test('host bridge preserves the versioned state envelope and decodes its document', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const state = {
    schemaVersion: 1,
    groups: [{ id: 'group-a', parentId: 'root', name: 'A' }],
    shortcuts: [],
  };

  const promise = host.loadWorkspaceVersioned();
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:state-load-versioned');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    state: JSON.stringify(state),
    revision: 'a'.repeat(64),
  });

  assert.deepEqual(await promise, {
    state,
    revision: 'a'.repeat(64),
  });
});

test('host bridge preserves the checked-save result envelope', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const promise = host.saveWorkspaceChecked(JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }), 'a'.repeat(64));
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:state-save-checked');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: true,
    stateSave: { ok: true, revision: 'b'.repeat(64) },
  });
  assert.deepEqual(await promise, { ok: true, revision: 'b'.repeat(64) });
});

test('host bridge carries the Papers writer lease envelope and release token', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const acquire = host.acquireWorkspaceWriterLease();
  const acquireRequest = mock.parent.messages[0].message;
  assert.equal(acquireRequest.type, 'papers:project:workspace-writer-lease-acquire');
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: acquireRequest.requestId,
    ok: true,
    writerLease: { token: 'lease-1' },
  });
  assert.deepEqual(await acquire, { token: 'lease-1' });

  const release = host.releaseWorkspaceWriterLease('lease-1');
  const releaseRequest = mock.parent.messages[1].message;
  assert.equal(releaseRequest.type, 'papers:project:workspace-writer-lease-release');
  assert.equal(releaseRequest.token, 'lease-1');
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: releaseRequest.requestId,
    ok: true,
  });
  await release;
});

test('writer lease acquisition still waits past the ordinary 15s RPC timeout', async () => {
  // Proves the lifecycle-bound acquisition: with controllable timers advanced
  // a full second past the ordinary 15s RPC timeout, the request must still be
  // pending (not rejected), and a later grant must still resolve it. The old
  // implementation would reject at 15s and forget the requestId.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const id = ++sequence;
    timers.set(id, { callback, at: now + delay, args });
    return id;
  };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
      }
      if (!next) break;
      timers.delete(next.id);
      now = next.timer.at;
      next.timer.callback(...next.timer.args);
    }
    now = end;
  };
  try {
    const mock = createMockWindow();
    const host = createHostBridge(mock);
    let settled = false;
    const pending = host.acquireWorkspaceWriterLease().then((lease) => {
      settled = lease;
      return lease;
    });
    advance(16000);
    assert.equal(settled, false, 'lease acquisition must not time out after 16s');
    const request = mock.parent.messages[0].message;
    mock.dispatchMessage({
      type: 'papers:host:result',
      requestId: request.requestId,
      ok: true,
      writerLease: { token: 'lease-long-lived' },
    });
    assert.deepEqual(await pending, { token: 'lease-long-lived' });
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('host bridge can request a new Papers surface without naming a project id', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const url = 'papers-backpack://bp-test/open/one/public/workspace-20260730b.js?as-you-go-folder=g1';
  const promise = host.openNewSurface(url);
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:open-new-surface');
  assert.equal(sent.url, url);
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true });
  await promise;
});

test('host bridge window observation/control methods carry the capability and unwrap outcomes', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const capability = { version: 1, runtimeToken: 'Ta', title: 'Window A', processId: 1001 };

  const observe = host.observeWindowCapability(capability);
  const sentObserve = mock.parent.messages[0].message;
  assert.equal(sentObserve.type, 'papers:project:window-observe-capability');
  assert.deepEqual(sentObserve.capability, capability);
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentObserve.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'minimized', bounds: { x: 1, y: 2, width: 300, height: 200 } },
  });
  const observed = await observe;
  assert.equal(observed.outcome, 'success');
  assert.equal(observed.observation.state, 'minimized');

  const minimized = host.minimizeWindowCapability(capability);
  const sentMin = mock.parent.messages[1].message;
  assert.equal(sentMin.type, 'papers:project:window-minimize-capability');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentMin.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'minimized', bounds: null },
  });
  assert.equal((await minimized).outcome, 'success');

  const restored = host.restoreWindowCapability(capability);
  const sentRestore = mock.parent.messages[2].message;
  assert.equal(sentRestore.type, 'papers:project:window-restore-capability');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentRestore.requestId, ok: true,
    outcome: 'missing', error: 'gone',
  });
  assert.deepEqual(await restored, { outcome: 'missing', observation: null, error: 'gone' });

  const closed = host.closeWindowCapability(capability);
  const sentClose = mock.parent.messages[3].message;
  assert.equal(sentClose.type, 'papers:project:window-close-capability');
  assert.deepEqual(sentClose.capability, capability);
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentClose.requestId, ok: true,
    outcome: 'success',
  });
  assert.equal((await closed).outcome, 'success');

  const applied = host.applyWindowCapability(capability, { x: 5, y: 6, width: 400, height: 300 });
  const sentApply = mock.parent.messages[4].message;
  assert.equal(sentApply.type, 'papers:project:window-apply-capability');
  assert.deepEqual(sentApply.bounds, { x: 5, y: 6, width: 400, height: 300 });
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentApply.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'normal', bounds: { x: 5, y: 6, width: 400, height: 300 } },
  });
  assert.equal((await applied).outcome, 'success');

  const resolved = host.resolveWindowDescriptor({ version: 1, title: 'Window A', processId: 1001 });
  const sentResolve = mock.parent.messages[5].message;
  assert.equal(sentResolve.type, 'papers:project:window-resolve-descriptor');
  assert.deepEqual(sentResolve.descriptor, { version: 1, title: 'Window A', processId: 1001 });
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentResolve.requestId, ok: true,
    outcome: 'missing', error: 'no visible window matches',
  });
  assert.deepEqual(await resolved, { outcome: 'missing', observation: null, error: 'no visible window matches' });

});

test('window layout diagnostics send only bounded stage and outcome enums', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const pending = host.windowLayoutDiagnostic({ stage: 'auto-add-resolve', outcome: 'success' });
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:window-diagnostic');
  assert.deepEqual(Object.keys(sent).sort(), ['outcome', 'requestId', 'stage', 'type'].sort());
  assert.equal(sent.stage, 'auto-add-resolve');
  assert.equal(sent.outcome, 'success');
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true, outcome: 'success' });
  assert.deepEqual(await pending, { outcome: 'success', observation: null, error: null });

  assert.deepEqual(await host.windowLayoutDiagnostic({ stage: 'auto-add-resolve', outcome: 'title-secret' }), { outcome: 'skipped' });
  assert.equal(mock.parent.messages.length, 1);
});

test('window candidates can explicitly request exact native window icons', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const pending = host.windowCandidates({ includeNativeIcons: true });
  const request = mock.parent.messages[0].message;
  assert.equal(request.type, 'papers:project:window-candidates');
  assert.equal(request.includeNativeIcons, true);
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: request.requestId, ok: true,
    outcome: 'success',
    candidates: [{ id: 'cap-1', windowInstanceId: 'W0123456789abcdef', title: 'Notepad', icon: 'data:native-icon' }],
  });
  const result = await pending;
  assert.equal(result.candidates[0].windowInstanceId, 'W0123456789abcdef');
  assert.equal(result.candidates[0].icon, 'data:native-icon');
});

test('ending an application process is a separate exact-capability operation from closing one window', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const capability = { version: 1, runtimeToken: 'opaque-exact-instance' };
  const pending = host.endProcessWindowCapability(capability);
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:window-end-process-capability');
  assert.deepEqual(sent.capability, capability);
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: true, outcome: 'success',
  });
  assert.deepEqual(await pending, { outcome: 'success', observation: null, error: null });
});

test('host bridge surfaces window capability failures as rejected outcomes, never as commands', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const pending = host.windowCandidates();
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:window-candidates');
  assert.ok(!('method' in sent) && !('command' in sent) && !('action' in sent), 'no arbitrary method field is posted');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: false, error: 'denied',
  });
  await assert.rejects(pending, /denied/);
});

test('host bridge exposes exact-window activation separately from minimize/restore', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const capability = { version: 1, bindingId: 'wl-binding-a' };
  const pending = host.activateWindowCapability(capability);
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:window-activate-capability');
  assert.deepEqual(sent.capability, capability);
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'normal', bounds: { x: 1, y: 2, width: 300, height: 200 } },
  });
  assert.equal((await pending).outcome, 'success');
});
test('018X1 detach pushes accept the canonical FLAT shape and the legacy detail wrapper', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const received = [];
  const unsubscribe = host.onDetachMessage((type, detail) => received.push({ type, detail }));

  // Canonical flat shape: { type, transferId, reason? } - the whole pushed
  // object is the detail (event.data.detail ?? event.data).
  mock.dispatchMessage({ type: 'papers:project:detach-stop-request', transferId: 't1', reason: 'crash' });
  assert.deepEqual(received[0], {
    type: 'papers:project:detach-stop-request',
    detail: { type: 'papers:project:detach-stop-request', transferId: 't1', reason: 'crash' },
  });

  // Legacy wrapper is still accepted.
  mock.dispatchMessage({ type: 'papers:project:detach-closed', detail: { transferId: 't2' } });
  assert.deepEqual(received[1], { type: 'papers:project:detach-closed', detail: { transferId: 't2' } });

  // Host result responses are never misrouted to detach listeners.
  mock.dispatchMessage({ type: 'papers:host:result', requestId: 'r', ok: true });
  assert.equal(received.length, 2);
  unsubscribe();
});

test('018X1 one-way detach ACKs resolve on the immediate OK host result, not the timeout', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const ack = host.detachStopAck('t1');
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:detach-stop-ack');
  assert.equal(sent.transferId, 't1');
  assert.ok(sent.requestId);
  // The preload posts an immediate OK result for the fire-and-forget send.
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true });
  assert.deepEqual(await ack, undefined);

  const focus = host.detachFocus();
  const sentFocus = mock.parent.messages[1].message;
  assert.equal(sentFocus.type, 'papers:project:detach-focus');
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sentFocus.requestId, ok: true });
  assert.deepEqual(await focus, undefined);
});
test('018V2 detachReady posts the exact two-sided-latch request and resolves on the immediate OK result', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const ready = host.detachReady();
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:detach-ready');
  assert.ok(sent.requestId);
  assert.equal('transferId' in sent, false, 'the page READY request carries no token/transfer');
  assert.equal('detail' in sent, false, 'the page READY request is detail-free');
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true });
  assert.deepEqual(await ready, undefined);
});

test('019C widgetOpen/Focus/Minimize/Close post exact bounded layout-key requests', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  host.widgetOpen('layout-a');
  host.widgetFocus('layout-a');
  host.widgetMinimize('layout-a');
  host.widgetClose('layout-a');
  host.widgetCloseSelf();
  host.widgetReady();
  const sent = mock.parent.messages.map((entry) => entry.message);
  assert.deepEqual(sent.map((message) => message.type), [
    'papers:project:widget-open',
    'papers:project:widget-focus',
    'papers:project:widget-minimize',
    'papers:project:widget-close',
    'papers:project:widget-close',
    'papers:project:widget-ready',
  ]);
  assert.equal(sent[0].layoutKey, 'layout-a');
  assert.equal(sent[1].layoutKey, 'layout-a');
  assert.equal(sent[2].layoutKey, 'layout-a');
  assert.equal(sent[3].layoutKey, 'layout-a');
  assert.equal('layoutKey' in sent[4], false, 'the widget self-close is token-attached by the preload');
  assert.equal('layoutKey' in sent[5], false, 'widget-ready is detail-free');
  // Resolve every request so no 15s timeout timer outlives the test.
  for (const entry of mock.parent.messages) {
    mock.dispatchMessage({ type: 'papers:host:result', requestId: entry.message.requestId, ok: true });
  }
  await new Promise((resolve) => setImmediate(resolve));
});

test('019C the widget host result resolves under its own ok/reused/error shape', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const opened = host.widgetOpen('layout-a');
  const sent = mock.parent.messages[0].message;
  // The preload wraps the session payload under the `widget` key so the
  // protocol ok flag is never shadowed.
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true, widget: { ok: true, reused: true } });
  assert.deepEqual(await opened, { ok: true, reused: true, error: null });

  const failed = host.widgetFocus('layout-a');
  const sentFailed = mock.parent.messages[1].message;
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sentFailed.requestId, ok: true, widget: { ok: false, error: 'compact widget failed to load' } });
  assert.deepEqual(await failed, { ok: false, reused: false, error: 'compact widget failed to load' });
});

test('019G windowThumbnailCapability posts the exact shared page request', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const capability = { version: 1, bindingId: 'b:1' };
  const promise = host.windowThumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:window-thumbnail');
  assert.ok(sent.requestId);
  assert.deepEqual(sent.capability, capability);
  assert.deepEqual(sent.options, { maxWidth: 240, maxHeight: 135 });
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true, outcome: 'success', imageUrl: 'data:image/png;base64,AAA', width: 240, height: 135 });
  // 019GR: success resolves EXACTLY { outcome, imageUrl, width, height }.
  assert.deepEqual(await promise, { outcome: 'success', imageUrl: 'data:image/png;base64,AAA', width: 240, height: 135 });
});

test('019G windowThumbnailCapability defaults to 240x135 and resolves payload-free fallbacks', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const capability = { version: 1, bindingId: 'b:2' };
  const promise = host.windowThumbnailCapability(capability);
  const sent = mock.parent.messages[0].message;
  assert.deepEqual(sent.options, { maxWidth: 240, maxHeight: 135 }, 'defaults to the shared 240x135');
  // 019GR: a payload-free typed fallback resolves EXACTLY { outcome } plus an
  // optional bounded error - never generic capability fields like
  // observation:null - and the test awaits the SAME request it dispatches.
  mock.dispatchMessage({ type: 'papers:host:result', requestId: sent.requestId, ok: true, outcome: 'minimized' });
  assert.deepEqual(await promise, { outcome: 'minimized' });
});

test('022 picker stage and commit post exact detail-free requests', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const stage = host.pickWindowStage();
  const commit = host.pickWindowCommit();
  const sent = mock.parent.messages.map((entry) => entry.message);
  assert.deepEqual(sent.map((message) => message.type), [
    'papers:project:window-pick-stage',
    'papers:project:window-pick-commit',
  ]);
  assert.equal('detail' in sent[0], false);
  assert.equal('detail' in sent[1], false);
  for (const entry of mock.parent.messages) {
    mock.dispatchMessage({ type: 'papers:host:result', requestId: entry.message.requestId, ok: true });
  }
  await Promise.all([stage, commit]);
});
