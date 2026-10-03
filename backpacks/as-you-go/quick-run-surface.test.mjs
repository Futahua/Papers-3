import test from 'node:test';
import assert from 'node:assert/strict';
import { closeQuickRunSession, openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import { mountQuickRun, paintQuickRunSurface, QUICK_RUN_WHEEL_SCROLL_WINDOW_MS } from './public/app/quick-run/quick-run-surface.js';

const state = {
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [
    {
      id: 's-1',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [
        { id: 'p-1', parentId: 'g-root', order: 1 },
        { id: 'p-2', parentId: 'g-root', order: 2 },
      ],
    },
  ],
  windowLayouts: [],
};

function fakeElement() {
  return {
    hidden: false, value: '', textContent: '', className: '', dataset: {}, style: {}, children: [],
    listeners: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); },
    fire(type, event) { for (const handler of this.listeners[type] ?? []) handler(event); },
  };
}

function harness() {
  const document = { createElement: (tag) => ({ tag, ...fakeElement() }) };
  const elements = {
    layer: fakeElement(), input: fakeElement(), chips: fakeElement(), results: fakeElement(),
    cap: fakeElement(), notice: fakeElement(),
  };
  return { document, elements };
}

/** A workspace whose query matches more rows than one session may paint (the cap is observable there). */
function crowdedState(count) {
  const shortcuts = [];
  for (let index = 0; index < count; index += 1) {
    shortcuts.push({
      id: `s-${index}`,
      name: `Kestrel ${index}`,
      target: `C:/corpus/kestrel-${index}.md`,
      placements: [{ id: `p-${index}`, parentId: 'g-root', order: index }],
    });
  }
  return { groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }], shortcuts, windowLayouts: [] };
}

test('a closed session draws nothing and hides the layer', () => {
  const h = harness();
  const drawn = paintQuickRunSurface({ ...h, session: closeQuickRunSession(openQuickRunSession(state)) });
  assert.equal(drawn, 0);
  assert.equal(h.elements.layer.hidden, true);
  assert.deepEqual(h.elements.chips.children, []);
  assert.deepEqual(h.elements.results.children, []);
  assert.equal(h.elements.input.value, '');
  assert.equal(h.elements.cap.hidden, true);
});

test('an open session shows the line, and an empty query draws no rows and no chips', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: openQuickRunSession(state) });
  assert.equal(h.elements.layer.hidden, false);
  assert.equal(h.elements.input.value, '');
  assert.deepEqual(h.elements.results.children, []);
  assert.deepEqual(h.elements.chips.children, []);
  assert.equal(h.elements.cap.hidden, true, 'nothing matched, so there is no cap to report');
});

test('a typed query draws one flat row per occurrence, with stable keys and one highlight', () => {
  const h = harness();
  const session = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  const drawn = paintQuickRunSurface({ ...h, session });
  assert.equal(drawn, 2);
  const rows = h.elements.results.children;
  assert.deepEqual(rows.map((row) => row.dataset.quickRunKey), ['link:p-1', 'link:p-2']);
  assert.deepEqual(rows.map((row) => row.dataset.quickRunHighlighted), ['true', 'false']);
  // The row carries section 1.2's three parts, in order.
  assert.deepEqual(rows[0].children.map((child) => child.className), [
    'quick-run-icon quick-run-icon-link',
    'quick-run-name',
    'quick-run-breadcrumb',
  ]);
  assert.equal(rows[0].children[1].textContent, 'Docs');
  assert.equal(rows[0].children[2].textContent, 'Workspace');
});

/* The creator's own per-item icons: state.json holds them as data URIs, the canvas paints them, and they are
   how a shortcut is recognised at a glance. Four repeated kind glyphs throw exactly that away. */
const ITEM_ICON = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoQABAALmk0mk0iIiIiIgBoSygABc6zbAAA';

const iconState = () => ({
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [
    { id: 's-art', name: 'Chrome', target: 'C:/chrome.exe', icon: ITEM_ICON, placements: [{ id: 'p-art', parentId: 'g-root', order: 1 }] },
    { id: 's-plain', name: 'Plain', target: 'C:/plain.exe', placements: [{ id: 'p-plain', parentId: 'g-root', order: 2 }] },
    { id: 's-text', name: 'Notapicture', target: 'C:/text.exe', icon: 'not-an-icon', placements: [{ id: 'p-text', parentId: 'g-root', order: 3 }] },
    { id: 's-empty', name: 'Emptystring', target: 'C:/empty.exe', icon: '', placements: [{ id: 'p-empty', parentId: 'g-root', order: 4 }] },
    { id: 's-notimage', name: 'Htmlpayload', target: 'C:/html.exe', icon: 'data:text/html;base64,PHN2Zz48L3N2Zz4=', placements: [{ id: 'p-notimage', parentId: 'g-root', order: 5 }] },
    { id: 's-number', name: 'Numbered', target: 'C:/num.exe', icon: 42, placements: [{ id: 'p-number', parentId: 'g-root', order: 6 }] },
  ],
  windowLayouts: [],
});

/** The icon box of the one row a query matches. */
function iconBoxFor(query) {
  const h = harness();
  paintQuickRunSurface({ ...h, session: quickRunSessionWithQuery(openQuickRunSession(iconState()), query) });
  const row = h.elements.results.children[0];
  assert.ok(row, `a row was drawn for "${query}"`);
  return row.children[0];
}

test("a row paints the item's own icon, and the kind glyph when there is none or it is unusable", () => {
  // An item with its own artwork: the picture is drawn in the row's icon box, byte for byte as the state
  // holds it - passed through, never decoded, re-encoded or rewritten.
  const drawn = iconBoxFor('chrome');
  assert.equal(drawn.className, 'quick-run-icon quick-run-icon-image');
  assert.equal(drawn.children.length, 1, 'the box holds the artwork, not the glyph as well');
  assert.equal(drawn.children[0].className, 'quick-run-icon-art');
  assert.equal(drawn.children[0].src, ITEM_ICON, 'the exact string the item carries');
  assert.equal(drawn.children[0].alt, '', 'decorative: the row already names the item');

  // An item without one keeps the kind glyph, and is not given anything invented.
  const plain = iconBoxFor('plain');
  assert.equal(plain.className, 'quick-run-icon quick-run-icon-shortcut');
  assert.deepEqual(plain.children, [], 'no picture, and no empty frame either');

  // Every unusable shape degrades to the glyph silently: prose, an empty string, a data payload that is not
  // an image, and a value that is not a string at all.
  for (const query of ['notapicture', 'emptystring', 'htmlpayload', 'numbered']) {
    const box = iconBoxFor(query);
    assert.equal(box.className, 'quick-run-icon quick-run-icon-shortcut', `${query} falls back to the kind glyph`);
    assert.deepEqual(box.children, [], `${query} draws no image element at all`);
  }
});

test('artwork that fails to decode is replaced by the kind glyph rather than a broken frame', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: quickRunSessionWithQuery(openQuickRunSession(iconState()), 'chrome') });
  const box = h.elements.results.children[0].children[0];
  assert.equal(box.className, 'quick-run-icon quick-run-icon-image');

  // The bytes were well-formed enough to be given to an img, and the decoder still refused them.
  box.children[0].fire('error', {});

  assert.equal(box.className, 'quick-run-icon quick-run-icon-shortcut', 'the glyph takes the box back');
  assert.deepEqual(box.children, [], 'and the failed image is gone rather than left as a frame');
});

test('a row with an icon still reports its kind, and a row without one never borrows another item\'s icon', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: quickRunSessionWithQuery(openQuickRunSession(iconState()), 'e') });
  const rows = h.elements.results.children;
  assert.ok(rows.length > 1, 'the query matched several rows');
  for (const row of rows) {
    const box = row.children[0];
    const carriesArt = box.className.includes('quick-run-icon-image');
    const source = carriesArt ? box.children[0].src : null;
    // Only the one item that has artwork may draw it, and it draws its own.
    assert.equal(carriesArt, row.dataset.quickRunKey === 'shortcut:p-art', `${row.dataset.quickRunKey} draws art only if it has its own`);
    if (carriesArt) assert.equal(source, ITEM_ICON);
  }
});

test('the chips mark All and the active type, and never carry the reader away from the field', () => {
  const h = harness();
  h.elements.input.value = 'half-typed';
  const session = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  paintQuickRunSurface({ ...h, session });
  const chips = h.elements.chips.children;
  assert.deepEqual(chips.map((chip) => chip.dataset.quickRunChip), ['All', 'Links']);
  assert.deepEqual(chips.map((chip) => chip.className), ['quick-run-chip active', 'quick-run-chip']);
  // The input is the reader's while a query is live: painting must not overwrite it.
  assert.equal(h.elements.input.value, 'half-typed');
});

test('closing clears the line, the chips and the rows', () => {
  const h = harness();
  const typed = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  paintQuickRunSurface({ ...h, session: typed });
  paintQuickRunSurface({ ...h, session: closeQuickRunSession(typed) });
  assert.equal(h.elements.layer.hidden, true);
  assert.equal(h.elements.input.value, '');
  assert.deepEqual(h.elements.chips.children, []);
  assert.deepEqual(h.elements.results.children, []);
  assert.equal(h.elements.cap.hidden, true);
});

test('a capped session paints the first 200 rows and says what it is not showing', () => {
  const h = harness();
  const session = quickRunSessionWithQuery(openQuickRunSession(crowdedState(500)), 'kestrel');
  const drawn = paintQuickRunSurface({ ...h, session });
  assert.equal(drawn, 200, 'the paint is bounded, which is the whole point of the cap');
  assert.equal(h.elements.results.children.length, 200);
  assert.equal(h.elements.cap.hidden, false);
  assert.equal(h.elements.cap.dataset.quickRunCap, 'true', 'the line is findable, and only while it is true');
  assert.equal(h.elements.cap.textContent, 'Showing the first 200 of 500 matches — keep typing to narrow.');
});

test('an uncapped session paints every match and draws no cap line at all', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: quickRunSessionWithQuery(openQuickRunSession(crowdedState(7)), 'kestrel') });
  assert.equal(h.elements.results.children.length, 7);
  assert.equal(h.elements.cap.hidden, true);
  assert.equal(h.elements.cap.dataset.quickRunCap, 'false');
  assert.equal(h.elements.cap.textContent, '');
});

test('a caller that mounts without the cap element still paints a capped session', () => {
  // The line is optional in exactly the way the notice already is: a caller with four elements paints rows.
  const h = harness();
  delete h.elements.cap;
  const drawn = paintQuickRunSurface({
    ...h,
    session: quickRunSessionWithQuery(openQuickRunSession(crowdedState(500)), 'kestrel'),
  });
  assert.equal(drawn, 200);
});

test('the cap line follows the query, appearing only while the match set is larger than the cap', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = {
    layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(),
    cap: liveElement(), notice: liveElement(),
  };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(300) });
  quickRun.open();
  assert.equal(elements.cap.hidden, true, 'an empty query shows nothing, so it cannot be capped');

  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(quickRun.session().capped, true);
  assert.equal(elements.cap.hidden, false);
  assert.equal(elements.cap.textContent, 'Showing the first 200 of 300 matches — keep typing to narrow.');
  assert.equal(elements.results.children.length, 200, 'the painted list and the sentence agree');

  elements.input.value = 'kestrel 2';
  elements.input.fire('input', {});
  assert.equal(quickRun.session().capped, false, 'this query matches fewer rows than the cap');
  assert.equal(elements.cap.hidden, true, 'so the line goes away rather than reporting an old number');
  assert.equal(elements.cap.textContent, '');
  assert.equal(elements.cap.dataset.quickRunCap, 'false');

  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(elements.cap.hidden, false, 'and it returns with the wider query');
});

/* The mounting test builds its own elements rather than reusing the painter's helper: the wiring is only
   reachable through listeners, so the mock has to record them and be able to fire them. */
function liveElement() {
  const element = {
    hidden: false, value: '', textContent: '', className: '', dataset: {}, children: [],
    listeners: {},
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    addEventListener(type, handler) { (element.listeners[type] ??= []).push(handler); },
    focus() { element.focused = true; },
    setSelectionRange(start, end) { element.selection = { start, end }; },
    // `this`, not the closed-over object: rows are built by spreading this template, so a row's own
    // scrollIntoView must record on the row rather than on the template it came from.
    scrollIntoView(options) { this.scrolledIntoView = options; },
    fire(type, event) { for (const handler of element.listeners[type] ?? []) handler(event); },
  };
  return element;
}

test('mounting wires the keys the contract binds, and opens on the current state', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });

  assert.equal(elements.layer.hidden, true, 'nothing is shown before it opens');
  assert.equal(quickRun.open(), true, 'the controller callback contract: open reports that it handled it');
  assert.equal(elements.layer.hidden, false);
  assert.equal(elements.input.focused, true, 'the line takes focus, so the reader types immediately');

  elements.input.value = 'docs';
  elements.input.fire('input', {});
  assert.equal(elements.results.children.length, 2);

  elements.layer.fire('keydown', { key: 'ArrowDown', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'link:p-2');
  elements.layer.fire('keydown', { key: 'ArrowUp', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'link:p-1');

  elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  // The AUTHOR ruling of 2026-09-12: the query "docs" offers only All and Links, so one Tab from All
  // lands on Links rather than stepping onto Folders, which the query has emptied.
  assert.equal(quickRun.session().filter, 'Links');
  assert.equal(quickRun.session().fellBack, false, 'nothing fell back, because nothing unavailable was entered');
  elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().filter, 'All', 'and the next step wraps back to All');
  elements.layer.fire('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(quickRun.session().filter, 'Links', 'Shift+Tab steps the same subset backwards');

  elements.layer.fire('keydown', { key: 'Escape', shiftKey: false, preventDefault() {} });
  assert.equal(elements.layer.hidden, true);
  assert.equal(elements.input.value, '');
  assert.deepEqual(elements.results.children, []);
  assert.equal(quickRun.session().open, false);
});

/* Type-to-run's surface half: the character that opened the palette has to be IN the line, exactly once.
   The controller prevents the browser's own insertion for exactly this reason, so the surface is the only
   thing that writes it - and it must write it once whether the palette was shut or already showing. */
test('opening with a seed puts the character in the line once and searches with it', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });

  assert.equal(quickRun.open('d'), true);
  assert.equal(elements.layer.hidden, false);
  assert.equal(elements.input.value, 'd', 'the opening character is in the line');
  assert.equal(quickRun.session().query, 'd', 'and it is the query, not just field text');
  assert.equal(elements.results.children.length, 2, 'so the palette opens already showing what it found');
  assert.deepEqual(elements.input.selection, { start: 1, end: 1 }, 'the caret sits after it, ready for the next letter');

  // Opening again with the same seed is the hostile case for a doubled first letter: one call, one character.
  quickRun.open('d');
  assert.equal(elements.input.value, 'd', 'a second open does not append a second copy');
  assert.equal([...elements.input.value].length, 1);
});

test('opening without a seed is unchanged: one empty focused line', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  assert.equal(elements.input.value, '');
  assert.equal(quickRun.session().query, '');
  assert.equal(elements.input.focused, true);
});

test('Escape puts the reader back where they were and changes nothing else', () => {
  // The cost the creator knowingly bought: a letter pressed meaning nothing shows a palette. Escape has to
  // give them back the exact place they were, with nothing selected, moved or changed - which is measured
  // here as focus returned and the session, the field and the list all empty again.
  const canvasButton = { isConnected: true, focused: 0, focus() { this.focused += 1; } };
  const document = { createElement: (tag) => ({ tag, ...liveElement() }), activeElement: canvasButton };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  // What the browser reports while the line holds focus: the palette is an ancestor of it.
  elements.layer.contains = (node) => node === elements.input || node === elements.layer;
  const quickRun = mountQuickRun({ document, elements, getState: () => state });

  quickRun.open('d');
  document.activeElement = elements.input;
  elements.layer.fire('keydown', { key: 'Escape', shiftKey: false, preventDefault() {} });

  assert.equal(elements.layer.hidden, true, 'the palette is gone');
  assert.equal(quickRun.session().open, false);
  assert.equal(elements.input.value, '', 'the line is empty again');
  assert.deepEqual(elements.results.children, [], 'and the list is empty again');
  assert.equal(canvasButton.focused, 1, 'focus is back on the control that had it');

  // The same close, from a palette that never had focus: nothing is stolen from wherever the reader is.
  const other = { isConnected: true, focused: 0, focus() { this.focused += 1; } };
  document.activeElement = other;
  quickRun.open('d');
  document.activeElement = other;
  quickRun.close();
  assert.equal(other.focused, 0, 'a close that did not own focus restores nothing');
});

test('a close after a row handed off does not steal focus back from where the hand-off went', () => {
  const elsewhere = { isConnected: true, focused: 0, focus() { this.focused += 1; } };
  const document = { createElement: (tag) => ({ tag, ...liveElement() }), activeElement: elsewhere };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.layer.contains = () => false;
  let activated = null;
  const quickRun = mountQuickRun({
    document, elements, getState: () => state, onActivate: (key) => { activated = key; },
  });
  quickRun.open('d');
  activated = null;
  elements.layer.fire('keydown', { key: 'Enter', shiftKey: false, altKey: false, preventDefault() {} });
  assert.equal(activated, 'link:p-1', 'Enter reached the hand-off with the highlighted row');
  assert.equal(elsewhere.focused, 0, 'and nothing is pulled back to the canvas afterwards');
});

test('the highlight is always a row of the displayed set, whatever was typed before it', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  for (const query of ['d', 'do', 'doc', 'docs', 'zzz', 'do']) {
    elements.input.value = query;
    elements.input.fire('input', {});
    const session = quickRun.session();
    const keys = session.rows.map((row) => row.resultKey);
    if (session.rows.length === 0) {
      assert.equal(session.highlightKey, null, 'no rows, no highlight');
    } else {
      assert.ok(keys.includes(session.highlightKey), 'the highlight is a row of the set it was given');
    }
    // And the painted rows agree with the session: what is highlighted is on screen exactly once.
    const painted = elements.results.children.map((row) => row.dataset.quickRunKey);
    assert.deepEqual(painted, keys);
  }
});

test('the wheel moves the highlight with the list, so Enter cannot run a row that scrolled away (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(10) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-0');

  assert.equal((elements.layer.listeners.wheel ?? []).length, 1, 'the wheel is handled');

  // The list keeps scrolling normally: the wheel is not taken from the reader, and the highlight travels
  // with the scroll rather than being left behind on a row that is no longer on screen.
  let prevented = false;
  elements.layer.fire('wheel', { deltaY: 48, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'scrolling is still the list\'s');
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2', 'two rows of scroll, two rows of highlight');

  elements.layer.fire('wheel', { deltaY: -24 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-1', 'scrolling back moves the highlight back');

  elements.layer.fire('wheel', { deltaY: 100000 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-9', 'a single flick cannot run off the painted list');
  assert.equal(elements.results.children.filter((row) => row.dataset.quickRunHighlighted === 'true').length, 1);
});

test('a sub-row wheel delta accumulates instead of moving a row per event (section 6.3)', () => {
  // A precision touchpad reports a stream of small pixel deltas. Treating every non-zero one as a whole row
  // ran the selection ahead of the list by however many events the gesture produced.
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(30) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  elements.layer.fire('wheel', { deltaY: 8 });
  elements.layer.fire('wheel', { deltaY: 8 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-0', 'two thirds of a row is not a row');

  elements.layer.fire('wheel', { deltaY: 8 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-1', 'the third event completes the row, and only now does one move');

  elements.layer.fire('wheel', { deltaY: 24 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2', 'and the remainder carried over rather than being discarded');

  // A new query is a new list: travel still owed to the old gesture is dropped, so the first small delta on
  // the new list cannot complete a row the old one started.
  elements.layer.fire('wheel', { deltaY: 20 });
  elements.input.value = 'kestrel 2';
  elements.input.fire('input', {});
  const afterTyping = quickRun.session().highlightKey;
  assert.notEqual(afterTyping, null, 'the narrower query still matched rows');
  elements.layer.fire('wheel', { deltaY: 8 });
  assert.equal(quickRun.session().highlightKey, afterTyping, 'the leftover 20 px does not decide the new list');
});

test('the wheel honours deltaMode: a line is a row and a page is what the list shows (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.results.clientHeight = 240; // ten rows of 24 px
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(40) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  // deltaMode 1 is lines: read as pixels, two lines would have been two pixels and moved nothing.
  elements.layer.fire('wheel', { deltaY: 2, deltaMode: 1 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2', 'two lines are two rows');

  // deltaMode 2 is pages: read as pixels, one page would have been one pixel.
  elements.layer.fire('wheel', { deltaY: 1, deltaMode: 2 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-12', 'one page is the ten rows the list shows at once');
});

test('a native scroll counts as the reader having scrolled, so typing resets the list to its top (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.results.scrollTop = 0;
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(60) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  // The reader drags the scrollbar: the element scrolls itself and no repaint of ours is involved, so the
  // only signal is the list's own scroll event.
  elements.results.scrollTop = 300;
  elements.results.fire('scroll', {});
  elements.input.value = 'kestrel 2';
  elements.input.fire('input', {});
  assert.equal(
    elements.results.scrollTop,
    0,
    'the new query starts at its own top rather than leaving the newly highlighted row above the viewport',
  );
});

test('the highlighted row is brought into view on movement, and typing never forces a scroll (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(30) });
  const scrolled = () => elements.results.children
    .filter((row) => row.scrolledIntoView)
    .map((row) => row.dataset.quickRunKey);

  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  // Typing starts a new list at its own top, where its first (highlighted) row already is. It must not
  // touch layout: forcing style-and-layout inside a keystroke is exactly what the paint cap keeps out, and
  // the integrated harness measures it (p95 4.3 ms without this call, 8.1 ms with it on every repaint).
  assert.deepEqual(scrolled(), [], 'typing does not force a scroll on the keystroke path');

  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.deepEqual(scrolled(), ['shortcut:p-1'], 'an arrow brings the new highlight into view, not merely marks it');

  elements.layer.fire('wheel', { deltaY: 48 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-3', 'the wheel still moves the highlight with the list');
  assert.deepEqual(
    scrolled(),
    [],
    'but the wheel adds no scroll of its own: the browser is already scrolling by the same travel, and a reveal here would emit a scroll event that could not be told from a manual drag',
  );
});

/** Elements whose list can scroll, so a wheel event is credited with the scroll it is about to cause. */
function scrollableElements() {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.results.scrollTop = 0;
  elements.results.clientHeight = 240;
  elements.results.scrollHeight = 1448;
  return { document, elements };
}

/** A mounted, open, typed surface over a scrollable list. */
function mountedOn(state) {
  const { document, elements } = scrollableElements();
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  return { quickRun, elements };
}

/* Fractional wheel travel belongs to the baseline it was measured against - a list, a highlight and a scroll
   position. Every non-wheel operation that establishes a new one discards it; the wheel's own scrolling
   keeps it, which is the whole point of accumulating. Each wheel event that moves the list is followed by
   the scroll event a browser emits for it, because that is what the credits are matched against. */

test('a filter change discards fractional wheel travel (section 6.3)', () => {
  const { quickRun, elements } = mountedOn(crowdedState(40));
  elements.layer.fire('wheel', { deltaY: 20 });
  elements.results.fire('scroll', {});
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-0', '20 px of a 24 px row moves nothing');

  elements.layer.fire('keydown', { key: 'Tab', preventDefault() {} });
  assert.equal(quickRun.session().filter, 'Shortcuts', 'the filter changed, so the list did too');

  elements.layer.fire('wheel', { deltaY: 4 });
  assert.equal(
    quickRun.session().highlightKey,
    quickRun.session().rows[0].resultKey,
    'and 4 px of travel left over from before the change cannot complete a row',
  );
});

test('arrow movement discards fractional wheel travel (section 6.3)', () => {
  const { quickRun, elements } = mountedOn(crowdedState(40));
  elements.layer.fire('wheel', { deltaY: 20 });
  elements.results.fire('scroll', {});

  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-1', 'the arrow moved one row');

  elements.layer.fire('wheel', { deltaY: 4 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-1', 'and 4 px of stale travel cannot move another');
});

test('a refreshed snapshot discards fractional wheel travel (section 6.3)', () => {
  let state = crowdedState(40);
  const { document, elements } = scrollableElements();
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  elements.layer.fire('wheel', { deltaY: 20 });
  elements.results.fire('scroll', {});

  state = { ...state, shortcuts: state.shortcuts.slice(1) };
  const refreshed = quickRun.refresh();
  assert.equal(refreshed.rows.length, 39, 'the refreshed list is the current state');

  elements.layer.fire('wheel', { deltaY: 4 });
  assert.equal(quickRun.session().highlightKey, refreshed.highlightKey, 'the stale 20 px went with the old baseline');
});

test("the wheel's own scrolling keeps fractional travel, however many scroll events it produces (section 6.3)", () => {
  // Measured in the host: one 20 px wheel event produced five scroll events (scroll positions 1, 6, 12, 17,
  // 20), because the wheel's scrolling is animated. Pairing one credit per wheel event with one scroll event
  // read the extra four as manual drags and threw the accumulation away.
  let clock = 0;
  const { document, elements } = scrollableElements();
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(40), now: () => clock });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  elements.layer.fire('wheel', { deltaY: 20 });
  for (let index = 0; index < 5; index += 1) {
    clock += 20;
    elements.results.fire('scroll', {});
  }
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-0', 'the wheel scrolled without completing a row');

  clock += 20;
  elements.layer.fire('wheel', { deltaY: 4 });
  elements.results.fire('scroll', {});
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-1', 'the accumulated 24 px moved exactly one row');
});

test('a drag that begins right after a wheel still discards fractional travel (section 6.3)', () => {
  // The case the recency window alone cannot decide, and which the host produced: the reader wheels 20 px and
  // grabs the scrollbar immediately, so the drag's scroll events arrive while the wheel's own animated
  // scrolling is still inside the window. The press is what settles it - measured in the host, a real
  // scrollbar drag delivers pointerdown with the list itself as the target.
  let clock = 0;
  const { document, elements } = scrollableElements();
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(40), now: () => clock });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  elements.layer.fire('wheel', { deltaY: 20 });
  clock += 30;
  elements.results.fire('pointerdown', {});
  elements.results.fire('scroll', {});
  elements.results.fire('pointerup', {});
  clock += 10;
  assert.ok(clock < QUICK_RUN_WHEEL_SCROLL_WINDOW_MS, 'the whole drag happened inside the wheel window');
  elements.layer.fire('wheel', { deltaY: 4 });
  assert.equal(
    quickRun.session().highlightKey,
    'shortcut:p-0',
    'the press, not the clock, decided that this scroll was manual',
  );
});

test('a press and release that straddle the scroll they cause still count as manual (section 6.3)', () => {
  // The host's own ordering, measured page-side: pointerdown at 8992 ms, pointerup at 8994 ms, and the
  // scroll the press caused at 8995 ms - a click on the scrollbar track, whose press is over before its
  // scroll arrives. A press therefore has to mark the next scroll as manual even though it is no longer down.
  let clock = 0;
  const { document, elements } = scrollableElements();
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(40), now: () => clock });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  elements.layer.fire('wheel', { deltaY: 20 });
  clock += 30;
  elements.results.fire('pointerdown', {});
  elements.results.fire('pointerup', {});
  elements.results.fire('scroll', {}); // the jump the press caused, arriving after the release
  clock += 10;
  elements.layer.fire('wheel', { deltaY: 4 });
  assert.equal(
    quickRun.session().highlightKey,
    'shortcut:p-0',
    'the press marked the scroll that followed it, so the stale 20 px is gone',
  );
});

test('a manual scroll discards fractional wheel travel (section 6.3)', () => {
  let clock = 0;
  const { document, elements } = scrollableElements();
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(40), now: () => clock });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});

  elements.layer.fire('wheel', { deltaY: 20 });
  elements.results.fire('scroll', {}); // the wheel's own scroll, inside the window
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-0', '20 px of a 24 px row moves nothing');

  // The wheel's scrolling is over, so the next scroll is somebody else's: a dragged scrollbar or a touch
  // scroll. It is a new scroll baseline, and the travel owed to the old one goes with it.
  clock += QUICK_RUN_WHEEL_SCROLL_WINDOW_MS + 1;
  elements.results.fire('scroll', {});
  elements.layer.fire('wheel', { deltaY: 4 });
  assert.equal(
    quickRun.session().highlightKey,
    'shortcut:p-0',
    'the stale 20 px cannot complete a row on 4 px of travel after a manual scroll',
  );
});

test('a keystroke touches no scroll box, and the list resets to its top once the reader has scrolled', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.results.scrollTop = 90;
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(30) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  // The keystroke path is the one the integrated harness measures, so it must not read or write the scroll
  // box: doing so forces style-and-layout for 200 fresh rows inside the measured window.
  assert.equal(elements.results.scrollTop, 90, 'typing leaves the scroll box completely alone');

  // Once a movement has scrolled the list, the next query starts its own list at the top, so the row the
  // highlight moved to is not left above the fold.
  elements.layer.fire('wheel', { deltaY: 48 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2');
  assert.equal(elements.results.scrollTop, 90, 'the movement keeps the reader where they were');
  elements.input.value = 'kestrel 2';
  elements.input.fire('input', {});
  assert.equal(elements.results.scrollTop, 0, 'and the new query starts at its own top');
});

test('a non-empty query with no matches says so instead of drawing a blank layer', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(), notice: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(3) });
  quickRun.open();
  assert.equal(elements.notice.hidden, true, 'an empty query is not a failed search, so it says nothing');

  elements.input.value = 'zzzz';
  elements.input.fire('input', {});
  assert.equal(elements.results.children.length, 0, 'no matches means no rows');
  assert.equal(elements.chips.children.length, 0, 'and no chips');
  assert.equal(elements.notice.hidden, false, 'but the layer is not left blank: a stall and an answer differ');
  assert.equal(elements.notice.textContent, 'No matches for “zzzz”.');

  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(elements.notice.hidden, true, 'and the line goes away once there is something to show');
  assert.equal(elements.notice.textContent, '');
});

test('a result that turns out to be gone is replaced by the current matches, not left to be hit again (section 5)', () => {
  let state = crowdedState(6);
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2', 'the reader asked for the third row');

  // The workspace moves under the open surface: the highlighted occurrence, and one before it, are gone.
  state = {
    ...state,
    shortcuts: state.shortcuts.filter((shortcut) => shortcut.id !== 's-0' && shortcut.id !== 's-2'),
  };
  const refreshed = quickRun.refresh();

  assert.equal(quickRun.session().query, 'kestrel', 'the query the reader typed is kept');
  assert.deepEqual(
    refreshed.rows.map((row) => row.resultKey),
    ['shortcut:p-1', 'shortcut:p-3', 'shortcut:p-4', 'shortcut:p-5'],
    'the list is the current state rather than the snapshot the dead row came from',
  );
  assert.equal(refreshed.highlightKey, 'shortcut:p-4', 'and the highlight lands on the survivor nearest the row that vanished');
  assert.equal(elements.results.children.length, 4, 'what is on screen is the refreshed list');
  assert.equal(elements.results.children[2].dataset.quickRunHighlighted, 'true', 'with exactly one highlight on it');
});

test('Shift+Enter is inert: the cut gesture does not become a second Enter (CUT 2026-09-13)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(), notice: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({ document, elements, getState: () => state, onActivate: (key) => activated.push(key) });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});
  const before = quickRun.session();

  let prevented = false;
  elements.layer.fire('keydown', { key: 'Enter', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'the mount does not claim a chord it no longer implements');
  assert.deepEqual(activated, [], 'and it runs nothing at all');
  assert.equal(quickRun.session(), before, 'the session is untouched');
  assert.equal(elements.notice.hidden, true, 'and no notice claims the gesture exists');
});

test('the chord toggles: it opens a closed palette and dismisses an open one (the creator reported no toggle)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });

  assert.equal(quickRun.toggle(), true, 'the first press opens and reports that it opened');
  assert.equal(elements.layer.hidden, false);
  elements.input.value = 'docs';
  elements.input.fire('input', {});
  assert.equal(elements.results.children.length, 2);

  assert.equal(quickRun.toggle(), false, 'the second press closes and reports that it did not open');
  assert.equal(elements.layer.hidden, true, 'the palette the chord opened is the palette it dismisses');
  assert.equal(elements.input.value, '', 'and closing still leaves nothing behind');
  assert.equal(quickRun.session().open, false);

  assert.equal(quickRun.toggle(), true, 'and the next press opens it again');
  assert.equal(elements.layer.hidden, false);
  assert.deepEqual(elements.results.children, [], 'a reopened palette starts empty rather than resuming the query');
});

test('Enter and a click reach one activation path, and neither invents its own (section 6.4)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({
    document,
    elements,
    getState: () => state,
    onActivate: (key) => activated.push(key),
  });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});

  // The keyboard: Enter activates whatever is highlighted.
  elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(activated, ['link:p-1']);

  // The pointer: a click on a row reports the same key through the same function.
  elements.results.children[1].fire('click', {});
  assert.deepEqual(activated, ['link:p-1', 'link:p-2']);
});

test('Enter with nothing highlighted activates nothing', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({ document, elements, getState: () => state, onActivate: (key) => activated.push(key) });
  quickRun.open();
  elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(activated, [], 'an empty query has no row to run');
});

test('hover marks the row under the pointer and never becomes the keyboard selection', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({ document, elements, getState: () => state, onActivate: (key) => activated.push(key) });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});
  const highlighted = quickRun.session().highlightKey;
  assert.equal(highlighted, 'link:p-1');

  // The pointer moves onto the second row.
  elements.results.children[1].fire('mouseover', {});
  assert.equal(elements.results.children[1].dataset.quickRunHovered, 'true');
  assert.equal(elements.results.children[0].dataset.quickRunHovered, 'false');
  // Marked hovered, still not highlighted, and the keyboard still owns the choice.
  assert.equal(elements.results.children[1].dataset.quickRunHighlighted, 'false');
  assert.equal(quickRun.session().highlightKey, highlighted, 'hover does not move the keyboard highlight');
  elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(activated, ['link:p-1'], 'Enter runs the keyboard highlight, not the hovered row');
});

test('typing never re-reads the world: the snapshot is taken at open and ranked in memory (section 5)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  let reads = 0;
  const quickRun = mountQuickRun({
    document,
    elements,
    getState: () => { reads += 1; return state; },
    onActivate: () => {},
  });
  quickRun.open();
  assert.equal(reads, 1, 'opening reads the workspace once');
  for (const query of ['d', 'do', 'doc', 'docs', 'doc', 'zzz']) {
    elements.input.value = query;
    elements.input.fire('input', {});
    elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
    elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  }
  assert.equal(reads, 1, 'and nothing a keystroke does reads it again');
});

test('captured hover keystrokes append to the already-open query in order', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open('v');
  assert.equal(quickRun.appendText('i'), true);
  assert.equal(elements.input.value, 'vi');
  assert.equal(quickRun.session().query, 'vi');
  assert.deepEqual(elements.input.selection, { start: 2, end: 2 });
  quickRun.close();
  assert.equal(quickRun.appendText('x'), false, 'closed surfaces do not receive stale native input');
});

test('hydrated link rows expose the shared favicon request and retain a fixed fallback slot', () => {
  const h = harness();
  paintQuickRunSurface({
    ...h,
    hydrateIcons: true,
    session: quickRunSessionWithQuery(openQuickRunSession(state), 'docs'),
  });
  const icon = h.elements.results.children[0].children[0];
  assert.equal(icon.children[0].dataset.webIcon, 'https://example.com/docs');
  assert.equal(icon.children[0].hidden, true, 'the fallback remains visible until hydration succeeds');
  assert.equal(icon.children[1].className, 'quick-run-icon-fallback');
});

test('the in-workspace card resize commits bounded geometry for the next open', () => {
  const h = harness();
  const documentListeners = {};
  const document = {
    createElement: (tag) => ({ tag, ...liveElement() }),
    documentElement: { clientWidth: 1600, clientHeight: 1000 },
    addEventListener(type, handler) { (documentListeners[type] ??= []).push(handler); },
    removeEventListener(type, handler) {
      documentListeners[type] = (documentListeners[type] ?? []).filter((candidate) => candidate !== handler);
    },
    fire(type, event) { for (const handler of documentListeners[type] ?? []) handler(event); },
  };
  h.elements.layer.style = {};
  h.elements.layer.getBoundingClientRect = () => ({ width: 680, height: 320 });
  let saved = null;
  const surface = mountQuickRun({
    ...h, document,
    getState: () => state,
    onCardSizeChanged: (size) => { saved = size; },
  });
  const handle = h.elements.layer.children[0];
  surface.open();
  handle.fire('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, preventDefault() {} });
  document.fire('pointermove', { clientX: 210, clientY: 160, pointerId: 1 });
  assert.equal(h.elements.layer.dataset.quickRunSized, 'true', 'the card becomes sized during the drag');
  document.fire('pointerup', { pointerId: 1 });
  assert.deepEqual(saved, { width: 880, height: 470 });
  assert.equal(h.elements.layer.style.width, '880px');
  assert.equal(h.elements.layer.style.height, '470px');
});
/* The launcher overlay: the same surface in a 640x220 window with no workspace behind it.
   Three things differ from the canvas, and each one is a decision rather than a drift:
   the marker already opened it, Escape belongs to the host, and nothing may take focus back
   from the application the creator came from. Everything else - the session, the ranking, the
   rows, Enter - is the same code. */
test('the overlay opens itself, and Escape is left to the host', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state, commandSurface: true });

  // The entry opens it once the boot has finished - mount happens before the collaborators exist, so the
  // surface cannot open itself - and from then on it behaves like the canvas surface.
  quickRun.open();
  assert.equal(elements.layer.hidden, false, 'the overlay shows the surface');
  assert.equal(elements.input.focused, true, 'and the line has the keyboard');
  assert.equal(quickRun.session().open, true);

  // Escape must not close it: the host tears the window down, and an emptied window the host still has up
  // would be an always-on-top box with nothing in it.
  let prevented = false;
  elements.layer.fire('keydown', { key: 'Escape', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(elements.layer.hidden, false, 'the palette stays up');
  assert.equal(quickRun.session().open, true);
  assert.equal(prevented, false, 'and the key is not claimed, so the host still sees it');
});

test('the overlay does not take focus back when it closes', () => {
  // Lane 4 hands focus to the application the creator came from while an action runs. A page that focused
  // its own body on close would fight that, so in this mode nothing is restored.
  const canvasButton = { isConnected: true, focused: 0, focus() { this.focused += 1; } };
  const document = { createElement: (tag) => ({ tag, ...liveElement() }), activeElement: canvasButton };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.layer.contains = (node) => node === elements.input || node === elements.layer;
  const quickRun = mountQuickRun({ document, elements, getState: () => state, commandSurface: true });
  quickRun.open();
  document.activeElement = elements.input;
  quickRun.close();
  assert.equal(canvasButton.focused, 0, 'nothing in the page takes focus back');
});

test('a second invoke lands on an empty focused line, never an appended one', () => {
  // The creator may press the chord again while the overlay is up. That must put them on a cleared line,
  // not append to what is already there and not do nothing.
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state, commandSurface: true });
  quickRun.open();

  elements.input.value = 'docs';
  elements.input.fire('input', {});
  assert.equal(elements.input.value, 'docs');
  assert.equal(elements.results.children.length, 2, 'a live query with rows');

  quickRun.focusEmptyLine();
  assert.equal(elements.input.value, '', 'the line is cleared');
  assert.equal(quickRun.session().query, '', 'and so is the query');
  assert.deepEqual(elements.results.children, [], 'the rows are gone with it');
  assert.equal(elements.input.focused, true, 'and the line has the keyboard again');

  // Called again on an already-empty line it is idempotent rather than doing nothing visible.
  quickRun.focusEmptyLine();
  assert.equal(elements.input.value, '');
  assert.equal(elements.input.focused, true);
});
