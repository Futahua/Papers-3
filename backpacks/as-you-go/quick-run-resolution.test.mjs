// Section 10's resolution decision, tested where it is decidable: no host, no window, just the rule.
//
// The live half - asking the host for windows and raising one - cannot be tested from here and is not
// claimed. What is claimed is the part that has to be right before any of that: one match or a typed
// refusal, never a substitute, and never an activation the plan did not authorise.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityAfterResolution,
  planQuickRunResolution,
  QUICK_RUN_RESOLUTION_AMBIGUOUS,
  QUICK_RUN_RESOLUTION_MISSING,
  QUICK_RUN_RESOLUTION_UNIQUE,
  resolveQuickRunMember,
} from './public/app/quick-run/quick-run-resolution.js';

const chrome = { id: 'w-1', title: 'Chrome', executableFingerprint: 'sha256:aaa' };
const member = (descriptor) => ({ id: 'm-1', descriptor });

test('an exact single match resolves uniquely and is the only outcome that may activate', () => {
  const plan = planQuickRunResolution(member({ title: 'Chrome' }), [chrome]);
  assert.equal(plan.outcome, QUICK_RUN_RESOLUTION_UNIQUE);
  assert.equal(plan.window, chrome, 'the window itself, not a copy and not an identity the module invented');
  assert.equal(plan.activate, true);
  assert.equal(plan.availability, 'available');
});

test('no match is missing, and nothing is activated', () => {
  const plan = planQuickRunResolution(member({ title: 'Firefox' }), [chrome]);
  assert.equal(plan.outcome, QUICK_RUN_RESOLUTION_MISSING);
  assert.equal(plan.activate, false);
  assert.equal(plan.availability, 'unavailable');
  assert.deepEqual(plan.candidates, []);
});

test('two matches are ambiguous, the candidates are reported, and nothing is chosen', () => {
  const second = { id: 'w-2', title: 'Chrome', executableFingerprint: 'sha256:bbb' };
  const plan = planQuickRunResolution(member({ title: 'Chrome' }), [chrome, second]);
  assert.equal(plan.outcome, QUICK_RUN_RESOLUTION_AMBIGUOUS);
  assert.deepEqual(plan.candidates, ['w-1', 'w-2']);
  assert.equal(plan.window, undefined, 'no window is picked, which is what "never substitutes" means here');
  assert.equal(plan.activate, false, 'and an ambiguous resolution authorises zero activate calls');
  assert.equal(plan.availability, 'unavailable');
});

test('a near miss is a miss: resolution never substitutes a window that merely looks like the target', () => {
  const plausible = [
    { id: 'w-3', title: 'Chrome Canary', executable: 'chrome.exe' },
    { id: 'w-4', title: 'Chrome', executable: 'chrome.exe', fingerprint: 'sha256:zzz' },
    // Not a near miss at all, and deliberately here: a field the descriptor does not declare is ignored,
    // so this one matches and the test would be wrong to call it a miss.
    { id: 'w-5', title: 'Chrome', executableFingerprint: 'sha256:aaa', extra: 'different' },
  ];
  const plan = planQuickRunResolution(member({ title: 'Chrome', executableFingerprint: 'sha256:aaa' }), plausible);
  assert.equal(plan.outcome, QUICK_RUN_RESOLUTION_UNIQUE, 'only the window that agrees on every declared field matches');
  assert.deepEqual(plan.candidates, ['w-5'], 'and the single candidate is the one that agreed');
  assert.equal(plan.activate, true);

  const misses = planQuickRunResolution(
    member({ title: 'Chrome', executableFingerprint: 'sha256:aaa' }),
    plausible.filter((window) => window.id !== 'w-5'),
  );
  assert.equal(misses.outcome, QUICK_RUN_RESOLUTION_MISSING, 'a longer title and a differing fingerprint are both misses');
  assert.equal(misses.activate, false);
});

test('a descriptor that declares nothing matches nothing, rather than everything', () => {
  assert.equal(resolveQuickRunMember({ id: 'm-2', descriptor: {} }, [chrome]).outcome, QUICK_RUN_RESOLUTION_MISSING);
  assert.equal(resolveQuickRunMember({ id: 'm-3' }, [chrome]).outcome, QUICK_RUN_RESOLUTION_MISSING);
  assert.equal(
    resolveQuickRunMember({ id: 'm-4', descriptor: { title: '   ' } }, [chrome]).outcome,
    QUICK_RUN_RESOLUTION_MISSING,
    'whitespace is not a declaration',
  );
  assert.equal(
    resolveQuickRunMember({ id: 'm-5', descriptor: { title: 'Chrome' } }, []).outcome,
    QUICK_RUN_RESOLUTION_MISSING,
    'and a host that reported no windows resolves nothing',
  );
});

test('the availability mapping is section 10.1, and unknown is not one of its outputs', () => {
  assert.equal(availabilityAfterResolution(QUICK_RUN_RESOLUTION_UNIQUE), 'available');
  assert.equal(availabilityAfterResolution(QUICK_RUN_RESOLUTION_MISSING), 'unavailable');
  assert.equal(availabilityAfterResolution(QUICK_RUN_RESOLUTION_AMBIGUOUS), 'unavailable');
  for (const outcome of [QUICK_RUN_RESOLUTION_UNIQUE, QUICK_RUN_RESOLUTION_MISSING, QUICK_RUN_RESOLUTION_AMBIGUOUS]) {
    assert.notEqual(availabilityAfterResolution(outcome), 'unknown', 'unknown belongs to an untouched item');
    assert.notEqual(availabilityAfterResolution(outcome), 'not-running');
  }
});
