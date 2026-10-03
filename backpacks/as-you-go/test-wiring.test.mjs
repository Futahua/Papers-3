// The wiring guard: a test file that no script runs is a test that will rot.
//
// This exists because the repository had three of them. `card-implementation.test.mjs`,
// `compact-card-parity.test.mjs` and `picker-keyboard-routing.test.mjs` all sat in the tree, all read the
// entry file to assert surface behaviour, and none of them was named by any test script — so nothing ran
// them and nothing noticed. Running them by hand showed why that matters: the picker one passes, and the
// other two fail, on markup and CSS that later work moved.
//
// The two failing files are named below rather than wired in, because wiring them would turn the suite red
// without answering the question they raise: is the test stale or did the surface regress? That is a
// creator eye-check, not a guess, and `EYE-TEST-PROBLEMS.md` is where those are recorded. Naming them here
// keeps them visible instead of invisible, and stops a fourth file joining them unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// Empty, and that is the point: both files this guard was written for are now wired in and passing. An
// entry here is a debt, so the map should stay empty unless a real reason appears.
const KNOWN_UNWIRED = new Map();

test('every test file is run by some test script, and the exceptions are named and justified', async () => {
  const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const wiring = Object.entries(pkg.scripts)
    .filter(([name]) => name === 'pretest' || name.startsWith('test'))
    .map(([, value]) => value)
    .join(' ');
  assert.notEqual(wiring.trim(), '', 'the scripts are readable, so this check means something');

  const files = (await readdir(new URL('.', import.meta.url)))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
  assert.ok(files.length > 50, `the repository has the suite this guard is about (found ${files.length} files)`);

  const unwired = files.filter((name) => !wiring.includes(name));
  assert.deepEqual(
    unwired.filter((name) => !KNOWN_UNWIRED.has(name)),
    [],
    'a test file that no script runs will rot quietly: wire it, or name it here with the reason it cannot be wired',
  );

  for (const name of KNOWN_UNWIRED.keys()) {
    assert.equal(files.includes(name), true, `${name} is still in the tree, so the exception is still real`);
  }
  assert.equal(
    wiring.includes('picker-keyboard-routing.test.mjs'),
    true,
    'the orphan that passes was wired in rather than left out',
  );
});
