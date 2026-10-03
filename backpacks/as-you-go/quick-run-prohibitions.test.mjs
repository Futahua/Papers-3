// Section 6: the things v1 must not attempt, asserted as absence rather than promised as intent.
//
// A prohibition is only worth a tick if something fails when it is broken, so this file scans the seven
// Quick Run modules and the entry wiring that mounts them for the facilities the section rules out - a
// network, a native call, an observer, a timer, a worker, a thumbnail, an embedding, a dependency - and
// then names, one line per prohibition, which of these scans or which behavioural test holds it. If a
// later pass adds any of those facilities, the first test fails and the box that promised its absence has
// to be re-opened rather than quietly kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const moduleNames = [
  'quick-run-types.js',
  'quick-run-search.js',
  'quick-run-index.js',
  'quick-run-session.js',
  'quick-run-presentation.js',
  'quick-run-surface.js',
  'quick-run-activation.js',
  // The composition seam joined this list when it was extracted from the entry file: it is part of Quick Run,
  // so the section 6 prohibitions and the ARCHITECTURE.md map have to cover it too.
  'quick-run-workspace.js',
];

const sources = await Promise.all([
  ...moduleNames.map((name) => readFile(new URL(`./public/app/quick-run/${name}`, import.meta.url), 'utf8')),
  readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8'),
]);

const entries = [
  ...moduleNames.map((name, index) => ({ name, text: sources[index] })),
  { name: 'workspace-20260730b.js (Quick Run region)', text: quickRunRegion(sources[moduleNames.length]) },
];

function quickRunRegion(entrySource) {
  const start = entrySource.indexOf('// Quick Run (STAGE 5)');
  const end = entrySource.indexOf('const keyboard = createKeyboardController({');
  return start >= 0 && end > start ? entrySource.slice(start, end) : '';
}

test('every source this file scans is real and non-empty', () => {
  for (const entry of entries) {
    assert.notEqual(entry.text, '', `${entry.name} was found and is not empty`);
  }
});

test('the architecture map names every Quick Run module, so the map cannot drift silently', async () => {
  // The repository's own rule is that ARCHITECTURE.md maps each change type to the module that owns it.
  // Nothing enforced it: quick-run-resolution.js was added to the tree and the map was not updated, and no
  // test noticed. This is that test, and it fails on a new module rather than on a reader's disappointment.
  const map = await readFile(new URL('./ARCHITECTURE.md', import.meta.url), 'utf8');
  const quickRunRow = map.split('\n').filter((line) => line.includes('public/app/quick-run/')).join('\n');
  assert.notEqual(quickRunRow, '', 'the map has a Quick Run row');
  for (const name of moduleNames) {
    assert.equal(
      quickRunRow.includes(name),
      true,
      `ARCHITECTURE.md must name ${name}`,
    );
  }
});

test('the forbidden facilities of section 6 are absent from Quick Run (scanned, not assumed)', () => {
  const forbidden = [
    // A network: search through fetched page titles, URL lookups, anything remote.
    'fetch(', 'XMLHttpRequest', 'https.request', 'node:http', 'axios',
    // Native or host work: window enumeration, activation, thumbnails, desktop scanning.
    'require(', 'electron', 'ipcRenderer', 'host.', 'capturePage', 'toDataURL', 'screenshot', 'thumbnail',
    // Background work: polling, observing, workers.
    'setInterval', 'setTimeout', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame',
    'new Worker', 'worker_threads', 'postMessage',
    // Ranking machinery the section excludes for v1.
    'embedding', 'embeddings', 'vector', 'cosine', 'similarity', 'openai', 'anthropic',
    // Resolution machinery the section defers, and relaunch-on-miss behaviour.
    'globalShortcut', 'registerHotkey', 'accelerator', 'relaunch', 'restartMissing',
  ];
  for (const entry of entries) {
    for (const token of forbidden) {
      assert.equal(
        entry.text.includes(token),
        false,
        `${entry.name} must not contain ${token}`,
      );
    }
  }
});

test('the query path has no verb syntax, and the cycle has no command entries', async () => {
  const queryPath = ['quick-run-types.js', 'quick-run-index.js', 'quick-run-search.js', 'quick-run-session.js'];
  const texts = await Promise.all(
    queryPath.map((name) => readFile(new URL(`./public/app/quick-run/${name}`, import.meta.url), 'utf8')),
  );
  for (const [index, text] of texts.entries()) {
    // Whole words for the two that appear inside ordinary prose ("verbatim" is not a verb syntax), and
    // plain substrings for the two that cannot be anything else.
    for (const word of ['verb', 'slash']) {
      assert.doesNotMatch(
        text,
        new RegExp(`\\b${word}\\b`, 'i'),
        `${queryPath[index]} must not parse ${word} syntax`,
      );
    }
    for (const token of ['command:', 'prefixCommand']) {
      assert.equal(text.includes(token), false, `${queryPath[index]} must not parse ${token}`);
    }
  }
});

test('the descriptor identity vocabulary is declared in one place, and read from there', async () => {
  // The drift this holds: resolution compared `executable` and `fingerprint` (names the model never
  // persists), while availability was keyed on layoutId + memberId + name - so a member whose fingerprint
  // changed under the same title kept an answer that belonged to a different window. One vocabulary, in the
  // module every other module already imports, is the fix; this is what stops a second copy growing back,
  // which matters most before any host-side activation starts reading these fields.
  //
  // The modules are enumerated from the directory rather than from a list here, because the list this file
  // scans for section 6 does not include quick-run-resolution.js: a hand-written list is exactly how the
  // module that had the duplicate vocabulary would have dodged the check.
  const directory = await readdir(new URL('./public/app/quick-run/', import.meta.url));
  const files = directory.filter((name) => name.endsWith('.js')).sort();
  assert.ok(files.includes('quick-run-resolution.js'), 'the enumeration covers the module that had the duplicate');
  assert.ok(files.includes('quick-run-types.js'), 'and the module that owns the vocabulary');
  const sources = new Map(await Promise.all(files.map(async (name) => [
    name,
    await readFile(new URL(`./public/app/quick-run/${name}`, import.meta.url), 'utf8'),
  ])));

  const declaring = files.filter((name) => /\['title', 'executableFingerprint'\]/.test(sources.get(name)));
  assert.deepEqual(declaring, ['quick-run-types.js'], 'exactly one module declares the descriptor identity fields');

  for (const name of ['quick-run-resolution.js', 'quick-run-search.js']) {
    assert.match(
      sources.get(name),
      /from '\.\/quick-run-types\.js'/,
      `${name} imports the vocabulary rather than keeping its own copy`,
    );
  }
  for (const name of files) {
    assert.doesNotMatch(
      sources.get(name),
      /const\s+DESCRIPTOR_FIELDS\s*=/,
      `${name} must not declare a private descriptor field list`,
    );
  }

  // And availability is noted against the descriptor the row carries, not against occurrence ids or the
  // display name it happens to show.
  const presentation = sources.get('quick-run-presentation.js');
  assert.match(presentation, /row\?\.descriptorKey/, 'the fingerprint is the row\'s declared descriptor identity');
  assert.doesNotMatch(presentation, /layoutId \?\? null|memberId \?\? null/, 'and not the occurrence ids');
});

/**
 * One line per section 6 prohibition: what it rules out, and what holds it here. The map is the point of
 * the file - a reader should not have to guess why a box is ticked.
 */
test('every v1 prohibition has a named holder', () => {
  const holders = [
    ['Papers-level universal command palette', 'no palette, registry or command discovery exists: the universe is groups, shortcuts and layout members, asserted by quick-run-universe.test.mjs'],
    ['Cross-Backpack aggregated search', 'quickRunRows takes one workspace state and has no second Backpack to aggregate; the entry passes the state it owns'],
    ['OS-global accelerator', 'the chord is workspace-scoped in the catalog and registered by the workspace keydown seam; the scan above finds no globalShortcut, registerHotkey or accelerator'],
    ['Quick Run invocation while another unrelated desktop application has focus', 'follows from the same fact: the binding is workspace-scoped, and nothing registers an OS-wide chord'],
    ['Prompt search', 'prompts are not a source; a populated promptLibrary contributes no row'],
    ['Whole-layout search', 'a layout appears only inside a member breadcrumb; the four row types are pinned'],
    ['Bin search', 'all four bin shapes are excluded from the universe'],
    ['Live "which applications are running" scanning', 'no observer, no timer, no host reference in any module; availability is computed from the row kind'],
    ['Native availability polling in the background', 'same scan, plus the section 3.4 table: nothing observes or polls'],
    ['Thumbnail generation for Quick Run rows', 'no thumbnail source, and the scan finds no capturePage, toDataURL, screenshot or thumbnail'],
    ['Desktop enumeration while typing', 'opening reads the workspace once and typing reads it no further; no native module is reachable'],
    ['Automatic relaunch of a missing layout member', 'activation is planned and deferred; the scan finds no relaunch path'],
    ['"Best guess" resolution for ambiguous window descriptors', 'there is no resolution at all yet, and the plan answers deferred with a reason rather than guessing'],
    ['Folder/shortcut semantic search through descriptions or file contents', 'matching reads the display name only, asserted in quick-run-index.test.mjs'],
    ['Search inside file contents', 'no module reads a file or a host; the scan finds no require or electron'],
    ['Search through link page titles fetched from the network', 'no network facility of any kind in the modules or the wiring'],
    ['Search by URL target unless separately approved later', 'matching reads the display name only; a target rides on the row for the action, never for the query'],
    ['AI ranking', 'no model, service or prompt reference in the ranking'],
    ['Embeddings/vector search', 'no embedding, vector, cosine or similarity reference'],
    ['Prompt/verb syntax in the query', 'the query is normalised text matched against names; the query path is scanned for verb parsing'],
    ['Command verbs inside the Tab filter cycle', 'the cycle is the five fixed contract names, asserted in quick-run-types.test.mjs'],
    ['Launch-a-shortcut-and-then-capture-its-new-window behavior for Shift+Enter', 'the gesture was cut on 2026-09-13 (see papers/quick-run.md): after the cut no key, no plan and no write exist for it, so nothing can capture a window'],
    ['Worker architecture before profiling proves it necessary', 'no worker, thread or message passing anywhere in the feature'],
    ['New search dependency/library before the pure matcher has been measured', 'the modules import each other and two model helpers, and nothing else'],
  ];
  assert.equal(holders.length, 24, 'every prohibition in the section is named exactly once');
  for (const [prohibition, holder] of holders) {
    assert.equal(typeof holder, 'string');
    assert.notEqual(holder.trim(), '', `${prohibition} names what holds it`);
  }
});
