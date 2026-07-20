const { add } = require('./util.cjs');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// Basic addition
test('add(1, 2) returns 3', () => {
  if (add(1, 2) !== 3) throw new Error(`Expected 3, got ${add(1, 2)}`);
});

test('add(-1, 1) returns 0', () => {
  if (add(-1, 1) !== 0) throw new Error(`Expected 0, got ${add(-1, 1)}`);
});

test('add(0, 0) returns 0', () => {
  if (add(0, 0) !== 0) throw new Error(`Expected 0, got ${add(0, 0)}`);
});

test('add(100, 200) returns 300', () => {
  if (add(100, 200) !== 300) throw new Error(`Expected 300, got ${add(100, 200)}`);
});

test('add(-5, -7) returns -12', () => {
  if (add(-5, -7) !== -12) throw new Error(`Expected -12, got ${add(-5, -7)}`);
});

test('add(1.5, 2.5) returns 4', () => {
  if (add(1.5, 2.5) !== 4) throw new Error(`Expected 4, got ${add(1.5, 2.5)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('ALL TESTS PASS');
} else {
  process.exit(1);
}
