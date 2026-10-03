import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createWidgetHoverPolicy, createWidgetHoverPolicyDiagnostics } from './public/app/widget-hover-policy.js';

test('widget Quick Run policy enables on hover and revokes immediately on pointer leave', () => {
  const calls = [];
  const policy = createWidgetHoverPolicy({
    publish: (enabled, bindings) => calls.push({ enabled, bindings: [...bindings] }),
  });
  const blocked = ['Alt+F4'];

  policy.updateWorkspacePolicy(true, blocked);
  assert.equal(calls.at(-1).enabled, false, 'workspace permission alone cannot enable typing');
  policy.setHovered(true);
  assert.equal(calls.at(-1).enabled, true);
  assert.deepEqual(calls.at(-1).bindings, blocked);
  policy.setHovered(false);
  assert.equal(calls.at(-1).enabled, false, 'leave publishes revocation synchronously');
  assert.equal(policy.isHovered(), false);
});

test('an unchanged workspace policy renews the native hover lease', () => {
  const calls = [];
  const policy = createWidgetHoverPolicy({ publish: (enabled) => calls.push(enabled) });
  policy.updateWorkspacePolicy(true, []);
  policy.setHovered(true);
  const before = calls.length;
  policy.updateWorkspacePolicy(true, []);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1), true);
  policy.setHovered(false);
  assert.equal(calls.at(-1), false);
});

test('a negative hover-policy acknowledgement stays silent and retries on the next renewal', async () => {
  let calls = 0;
  const warningCalls = [];
  const errorCalls = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...args) => warningCalls.push(args);
  console.error = (...args) => errorCalls.push(args);
  try {
    const policy = createWidgetHoverPolicy({
      publish: () => (++calls === 1 ? { outcome: 'failed' } : { outcome: 'success' }),
    });
    policy.updateWorkspacePolicy(true, []);
    await Promise.resolve();
    policy.updateWorkspacePolicy(true, []);
    await Promise.resolve();
    assert.equal(calls, 2);
  } finally {
    console.warn = warn;
    console.error = error;
  }
  assert.deepEqual(warningCalls, []);
  assert.deepEqual(errorCalls, []);
});

test('rejected hover-policy RPC stays silent and a later renewal retries it', async () => {
  const warningCalls = [];
  const errorCalls = [];
  const warn = console.warn;
  const error = console.error;
  let calls = 0;
  console.warn = (...args) => warningCalls.push(args);
  console.error = (...args) => errorCalls.push(args);
  try {
    const policy = createWidgetHoverPolicy({
      publish: async () => {
        calls += 1;
        if (calls === 1) throw new Error('private host error');
        return { outcome: 'success' };
      },
    });
    policy.updateWorkspacePolicy(true, []);
    await Promise.resolve();
    await Promise.resolve();
    policy.updateWorkspacePolicy(true, []);
    await Promise.resolve();
    assert.equal(calls, 2);
  } finally {
    console.warn = warn;
    console.error = error;
  }
  assert.deepEqual(warningCalls, []);
  assert.deepEqual(errorCalls, []);
});

test('a rejected policy renewal reports one fixed diagnostic and success clears the failure episode', async () => {
  const reports = [];
  const diagnostics = createWidgetHoverPolicyDiagnostics({ debug: (...args) => reports.push(args) });
  let calls = 0;
  const policy = createWidgetHoverPolicy({
    publish: async () => {
      calls += 1;
      if (calls === 1 || calls === 2 || calls === 4) throw new Error('private host error');
      return { outcome: 'success' };
    },
    ...diagnostics,
  });

  policy.updateWorkspacePolicy(true, []);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(reports, [['[AYG] Quick Run hover policy was not acknowledged']]);
  policy.updateWorkspacePolicy(true, []);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reports.length, 1, 'repeated failure is quiet until a successful acknowledgement');
  policy.setHovered(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reports.length, 1);
  policy.updateWorkspacePolicy(true, []);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(reports, [
    ['[AYG] Quick Run hover policy was not acknowledged'],
    ['[AYG] Quick Run hover policy was not acknowledged'],
  ], 'a later failure is reported again after successful renewal re-armed diagnostics');
  assert.equal(calls, 4);
});

test('workspace hover-policy failure uses fixed diagnostics and cannot create an AYG warning banner', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const policySource = await readFile(new URL('./public/app/widget-hover-policy.js', import.meta.url), 'utf8');
  const wiring = source.match(/const widgetHoverPolicy = createWidgetHoverPolicy\(\{([\s\S]*?)\n  \}\);/)?.[1] ?? '';
  assert.match(wiring, /publish:\s*\(enabled, blockedBindings\)\s*=>\s*host\.setWidgetHoverPolicy\(enabled, blockedBindings\)/);
  assert.match(wiring, /onPublishFailure:\s*widgetHoverPolicyDiagnostics\.onPublishFailure/);
  assert.match(wiring, /onPublishSuccess:\s*widgetHoverPolicyDiagnostics\.onPublishSuccess/);
  assert.doesNotMatch(wiring, /console\.(?:warn|error|debug)|setWindowLayout(?:Transient)?Status|statusToast/);
  assert.match(source, /createWidgetHoverPolicyDiagnostics\(\)/);
  assert.match(policySource, /const HOVER_POLICY_FAILURE_MESSAGE = '\[AYG\] Quick Run hover policy was not acknowledged'/);
  assert.match(policySource, /debug\(HOVER_POLICY_FAILURE_MESSAGE\)/);
  assert.doesNotMatch(policySource, /console\.(?:warn|error)\(/);
  assert.doesNotMatch(source, /setWindowLayout(?:Transient)?Status\([^\n]*Quick Run hover policy/);
});

test('Quick Run handles letters, editing keys and repeats only during physical hover', () => {
  const calls = [];
  const policy = createWidgetHoverPolicy({ publish: (enabled) => calls.push(enabled) });
  policy.updateWorkspacePolicy(true, []);
  const key = (value, extra = {}) => policy.planInput({
    key: value,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    ...extra,
  });

  for (const value of ['a', 'Backspace', 'Enter', ' ', 'a']) {
    assert.deepEqual(key(value), { kind: 'pass', reason: 'pointer-not-hovering' });
  }
  policy.setHovered(true);
  assert.deepEqual(key('a'), { kind: 'open', seed: 'a' });
  assert.deepEqual(key('b', { repeat: false }), { kind: 'open', seed: 'b' });
  assert.equal(key('c', { repeat: true }).reason, 'the-key-is-auto-repeating');
  assert.equal(key('Backspace').reason, 'not-a-printable-character');
  assert.equal(key('Enter').reason, 'not-a-printable-character');
  assert.equal(key(' ').reason, 'space-is-an-activation-key-elsewhere');

  policy.setHovered(false);
  assert.deepEqual(key('z'), { kind: 'pass', reason: 'pointer-not-hovering' });
  assert.equal(calls.at(-1), false);
});

test('Quick Run key capture is locally gated by hover and pagehide revokes the host policy', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /!widgetHoverPolicy\.isHovered\(\)[\s\S]*?widgetState\.pickUnsubscribe/);
  assert.match(source, /widgetRoot\.addEventListener\('pointerenter', onWidgetPointerEnter\)/);
  assert.match(source, /widgetRoot\.addEventListener\('pointermove', onWidgetPointerEnter\)/);
  assert.match(source, /widgetRoot\.addEventListener\('pointerleave', onWidgetPointerLeave\)/);
  assert.match(source, /window\.addEventListener\('pagehide', \(\) => \{\s*widgetHoverPolicy\.dispose\(\)/);
});
