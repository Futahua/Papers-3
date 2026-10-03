import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowLayoutCandidateBinder } from './public/app/window-layout-candidate-binding.js';

test('fresh candidate binding returns the original chooser row without relisting', async () => {
  const calls = [];
  const row = { id: 'c1', title: 'Notepad', applicationLabel: 'Notepad' };
  const bind = createWindowLayoutCandidateBinder({
    bindWindowCandidate: async (id) => {
      calls.push(['bind', id]);
      return { outcome: 'success', descriptor: { windowInstanceId: 'W0000000000000001' } };
    },
    listWindowCandidates: async () => {
      calls.push(['list']);
      return { outcome: 'success', candidates: [] };
    },
  });

  const result = await bind(row.id, row);
  assert.equal(result.row, row);
  assert.equal(result.bound.outcome, 'success');
  assert.deepEqual(calls, [['bind', 'c1']]);
});

test('a stale candidate id relists once and rebinds the one unambiguous matching row', async () => {
  const calls = [];
  const original = { id: 'old', title: 'Document', applicationLabel: 'Notepad' };
  const fresh = { id: 'fresh', title: 'Document', applicationLabel: 'Notepad' };
  const bind = createWindowLayoutCandidateBinder({
    bindWindowCandidate: async (id) => {
      calls.push(['bind', id]);
      return id === 'old'
        ? { outcome: 'missing' }
        : { outcome: 'success', descriptor: { windowInstanceId: 'W0000000000000001' } };
    },
    listWindowCandidates: async () => {
      calls.push(['list']);
      return { outcome: 'success', candidates: [fresh] };
    },
  });

  const result = await bind(original.id, original);
  assert.equal(result.row, fresh);
  assert.equal(result.bound.outcome, 'success');
  assert.deepEqual(calls, [['bind', 'old'], ['list'], ['bind', 'fresh']]);
});

test('ambiguous stale recovery fails closed and keeps the exact chooser row', async () => {
  const original = { id: 'old', title: 'GitHub', applicationLabel: 'Chrome' };
  let bindCalls = 0;
  const bind = createWindowLayoutCandidateBinder({
    bindWindowCandidate: async () => {
      bindCalls += 1;
      return { outcome: 'missing' };
    },
    listWindowCandidates: async () => ({
      outcome: 'success',
      candidates: [
        { id: 'a', title: 'GitHub', applicationLabel: 'Chrome' },
        { id: 'b', title: 'GitHub', applicationLabel: 'Chrome' },
      ],
    }),
  });

  const result = await bind(original.id, original);
  assert.equal(result.row, original);
  assert.equal(result.bound.outcome, 'missing');
  assert.equal(bindCalls, 1, 'ambiguous relist must not guess a replacement candidate');
});

test('application label disambiguates same-title windows during stale recovery', async () => {
  const original = { id: 'old', title: 'Settings', applicationLabel: 'App A' };
  const rebound = [];
  const bind = createWindowLayoutCandidateBinder({
    bindWindowCandidate: async (id) => {
      rebound.push(id);
      return id === 'old' ? { outcome: 'missing' } : { outcome: 'success' };
    },
    listWindowCandidates: async () => ({
      outcome: 'success',
      candidates: [
        { id: 'a', title: 'Settings', applicationLabel: 'App A' },
        { id: 'b', title: 'Settings', applicationLabel: 'App B' },
      ],
    }),
  });

  const result = await bind(original.id, original);
  assert.equal(result.row.id, 'a');
  assert.deepEqual(rebound, ['old', 'a']);
});

test('without a chooser row a stale id is not relisted or guessed', async () => {
  let listed = false;
  const bind = createWindowLayoutCandidateBinder({
    bindWindowCandidate: async () => ({ outcome: 'missing' }),
    listWindowCandidates: async () => {
      listed = true;
      return { outcome: 'success', candidates: [] };
    },
  });

  const result = await bind('old', null);
  assert.equal(result.bound.outcome, 'missing');
  assert.equal(result.row, null);
  assert.equal(listed, false);
});
