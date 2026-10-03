import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignBranchRigidity,
  branchCenterGravityStrength,
  branchLinkDistance,
  branchLinkStrength,
  forceBranchUncross,
  isotonicProjection,
  projectMonotoneChain,
} from './public/branch-uncross-force.js';

const node = (id, x, y) => ({ id, x, y, vx: 0, vy: 0 });

test('PAVA returns the least-squares monotone projection', () => {
  assert.deepEqual(isotonicProjection([0, 3, 2, 4]), [0, 2.5, 2.5, 4]);
});

test('longer branches resist center gravity progressively without becoming fixed', () => {
  const nodes = [node('root', 0, 0), node('a', 1, 0), node('b', 2, 0), node('c', 3, 0), node('d', 4, 0)];
  assignBranchRigidity(nodes, [
    { source: 'root', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ]);
  assert.deepEqual(nodes.map((candidate) => candidate.branchRigidity), [4, 4, 4, 4, 4]);
  assert.ok(branchCenterGravityStrength(nodes[0]) < branchCenterGravityStrength({ branchRigidity: 2 }));
  assert.ok(branchCenterGravityStrength(nodes[0]) > 0);
});

test('a long branch does not stiffen an unrelated short limb', () => {
  const nodes = [
    node('root', 0, 0), node('a', 1, 0), node('b', 2, 0), node('c', 3, 0), node('leaf', 0, 1),
  ];
  assignBranchRigidity(nodes, [
    { source: 'root', target: 'a' }, { source: 'a', target: 'b' }, { source: 'b', target: 'c' },
    { source: 'root', target: 'leaf' },
  ]);
  assert.equal(nodes.find((candidate) => candidate.id === 'leaf').branchRigidity, 1);
  assert.equal(branchCenterGravityStrength(nodes.find((candidate) => candidate.id === 'leaf')), 0.05);
});

test('long branches prioritize compact edges while short siblings remain unchanged', () => {
  const longSource = { branchRigidity: 6 };
  const longTarget = { branchRigidity: 6 };
  const shortTarget = { branchRigidity: 1 };
  const longLink = { source: longSource, target: longTarget };
  const shortSiblingLink = { source: longSource, target: shortTarget };

  assert.ok(branchLinkDistance(longLink) < branchLinkDistance(shortSiblingLink));
  assert.ok(branchLinkStrength(longLink) > branchLinkStrength(shortSiblingLink));
  assert.equal(branchLinkDistance(shortSiblingLink), 145);
  assert.equal(branchLinkStrength(shortSiblingLink), 0.14);
  assert.ok(branchLinkDistance({ source: { branchRigidity: 100 }, target: { branchRigidity: 100 } }) >= 105);
});

test('a looping branch projects to strict monotone progress with minimum gap', () => {
  const chain = [
    node('root', 0, 0),
    node('a', 100, 40),
    node('b', -80, 80),
    node('leaf', 180, 120),
  ];
  const projected = projectMonotoneChain(chain, 'x', 1, 18);
  for (let index = 1; index < projected.length; index += 1) {
    assert.ok(projected[index] >= projected[index - 1] + 18 - 1e-6);
  }
  assert.ok(Math.abs(projected[0]) < 0.001, 'the branch origin remains anchored');
});

test('constraint approaches its convex projection without flinging', () => {
  const nodes = [
    node('root', 0, 0),
    node('a', 100, 40),
    node('b', -80, 80),
    node('leaf', 180, 120),
  ];
  const force = forceBranchUncross({ gap: 18, maxStep: 1.8 });
  force.initialize(nodes);
  force.links([
    { source: 'root', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'b', target: 'leaf' },
  ]);
  force();
  assert.ok(nodes.some(({ vx, vy }) => Math.abs(vx) + Math.abs(vy) > 0));
  assert.ok(nodes.every(({ vx, vy }) => Math.abs(vx) <= 1.8 && Math.abs(vy) <= 1.8));
});

test('crossing sibling branches remain independent and untouched', () => {
  const nodes = [
    node('root', 0, 0),
    node('a', 50, 50), node('b', 100, 100), node('c', 150, 150),
    node('d', 150, 50), node('e', 100, 100), node('f', 50, 150),
  ];
  const force = forceBranchUncross({ gap: 18, maxStep: 1.8 });
  force.initialize(nodes);
  force.links([
    { source: 'root', target: 'a' }, { source: 'a', target: 'b' }, { source: 'b', target: 'c' },
    { source: 'root', target: 'd' }, { source: 'd', target: 'e' }, { source: 'e', target: 'f' },
  ]);
  force();
  assert.deepEqual(nodes.map(({ vx, vy }) => [vx, vy]), nodes.map(() => [0, 0]));
});

test('short limbs and valid shared junctions receive no unnecessary constraint', () => {
  const nodes = [node('root', 100, 0), node('left', 0, 200), node('right', 200, 200)];
  const force = forceBranchUncross();
  force.initialize(nodes);
  force.links([
    { source: 'root', target: 'left' },
    { source: 'root', target: 'right' },
  ]);
  force();
  assert.deepEqual(nodes.map(({ vx, vy }) => [vx, vy]), [[0, 0], [0, 0], [0, 0]]);
});
