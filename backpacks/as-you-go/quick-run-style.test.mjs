// Quick Run's surface exists — and the two numbers its behaviour depends on agree with it.
//
// The feature shipped behaviourally complete and visually absent: no stylesheet in the tree mentioned any
// of its classes, so in the real host #quick-run-layer computed to a static, transparent, in-flow block at
// (0,0) while #graph-viewport was an absolutely positioned 1400x825 sibling painted above it. The rows were
// drawn and every pointer event at their coordinates hit the graph instead; measured with elementFromPoint
// and a real click, and invisible to the rest of the suite, because no other test reads a stylesheet.
//
// So this file holds what a later edit could break silently: that the surface has a stylesheet at all, that
// it is layered above the workspace content and below the menus, that the list can scroll (without which
// the wheel rule has nothing to scroll), that every class the surface paints has a rule, and that the row
// height the wheel arithmetic falls back to is the height the stylesheet actually draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUICK_RUN_WHEEL_ROW_HEIGHT_PX } from './public/app/quick-run/quick-run-surface.js';

const css = await readFile(new URL('./public/styles/quick-run.css', import.meta.url), 'utf8');
const entryCss = await readFile(new URL('./public/workspace-20260730b.css', import.meta.url), 'utf8');
const baseCss = await readFile(new URL('./public/styles/base.css', import.meta.url), 'utf8');
const graphCss = await readFile(new URL('./public/styles/graph.css', import.meta.url), 'utf8');
const dialogCss = await readFile(new URL('./public/styles/dialogs.css', import.meta.url), 'utf8');
const contextMenuCss = await readFile(new URL('./public/styles/context-menu.css', import.meta.url), 'utf8');
const markup = await readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8');

/** The declarations of one single-selector rule, or '' when the rule does not exist. */
function ruleFor(selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const zIndexOf = (declarations) => Number(declarations.match(/z-index:\s*(-?\d+)/)?.[1] ?? NaN);

test('the surface has a stylesheet, and the page pulls it in', () => {
  assert.ok(css.trim().length > 0, 'public/styles/quick-run.css exists and is not empty');
  assert.match(entryCss, /@import url\('\.\/styles\/quick-run\.css'\);/, 'the workspace entry imports it, so the app loads it');
  // And the elements it styles are the production markup's, not a second set of names.
  const ids = [...markup.matchAll(/id="(quick-run-[a-z-]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(ids, [
    'quick-run-cap', 'quick-run-chips', 'quick-run-input', 'quick-run-layer', 'quick-run-notice', 'quick-run-results',
  ]);
});

test('the layer is an overlay above the workspace content and above every modal', () => {
  const layer = ruleFor('.quick-run-layer');
  assert.match(layer, /position:\s*absolute/, 'a palette floats over the workspace rather than taking layout space');
  const zIndex = zIndexOf(layer);
  assert.ok(Number.isFinite(zIndex), 'the layer sets an explicit z-index, so its order is decided rather than inherited');
  // What it used to render underneath: the graph viewport is a positioned, full-size sibling that sets no
  // z-index at all. A *static* layer with no z-index stayed below it (measured in the host: elementFromPoint
  // at the centre of a drawn result row returned #graph-viewport), so both halves below matter.
  const viewport = graphCss.slice(graphCss.indexOf('.graph-viewport {'));
  const viewportRule = viewport.slice(0, viewport.indexOf('}'));
  assert.match(viewportRule, /position:\s*absolute/, 'the graph viewport is positioned, so it paints above in-flow content');
  assert.match(viewportRule, /inset:\s*0/, 'and it covers the workspace');
  assert.equal(
    zIndexOf(viewportRule),
    NaN,
    'it has no z-index of its own, which is why an explicit one on the layer is what decides the order',
  );
  assert.ok(zIndex > 0, `the layer must paint above the positioned workspace content (z-index ${zIndex})`);
  // This assertion is the reverse of the one it replaces. It used to require the palette to sit *below* the
  // context menu (100) and the dialogs (120/130), so a menu or a dialog could paint over Quick Run - true of
  // a surface with no modal story, and reversed by the reviewer's ruling that the chord opens Quick Run from
  // inside those dialogs and that the palette has exclusive input while it is up. Read from the same
  // stylesheets as the numbers it is compared against, so it cannot drift from them.
  const modalLayers = [
    ...dialogCss.matchAll(/z-index:\s*(-?\d+)/g),
    ...contextMenuCss.matchAll(/z-index:\s*(-?\d+)/g),
  ].map((match) => Number(match[1]));
  assert.ok(modalLayers.length > 0, 'the dialog and context-menu stylesheets declare z-indexes to compare against');
  assert.ok(
    modalLayers.every((value) => zIndex > value),
    `the palette (z-index ${zIndex}) must paint above every menu and dialog (${modalLayers.join(', ')}), or the chord's punch-through would open an invisible surface`,
  );
  assert.ok(zIndex < 2147483640, 'and below the informational band, which is the one thing that may cover it');
  assert.match(layer, /width:\s*min\(/, 'the palette has a bounded width rather than spanning the window');
});

test('the list scrolls, which is what the wheel contract needs', () => {
  const results = ruleFor('.quick-run-results');
  assert.match(results, /max-height:\s*\d/, 'a bounded height is what gives the list something to scroll');
  assert.match(results, /overflow-y:\s*auto/, 'and it scrolls, so the wheel moves the viewport it moves the highlight with');
  assert.match(results, /list-style:\s*none/, 'result rows are rows, not a bulleted list');
});

test('the row height the wheel arithmetic falls back to is the height the stylesheet draws', () => {
  // quick-run-surface.js turns a wheel delta into rows with the painted row's offsetHeight, and falls back
  // to QUICK_RUN_WHEEL_ROW_HEIGHT_PX when it cannot measure. The two must be the same number, or one wheel
  // notch moves the highlight a different distance from the pixels it scrolled.
  const row = ruleFor('.quick-run-result');
  const minHeight = Number(row.match(/min-height:\s*(\d+)px/)?.[1] ?? NaN);
  assert.equal(minHeight, QUICK_RUN_WHEEL_ROW_HEIGHT_PX, 'the stylesheet row height and the wheel fallback agree');
});

test('every class the surface paints has a rule, and the states it marks are styled', () => {
  const painted = [
    '.quick-run-layer', '.quick-run-input', '.quick-run-chips', '.quick-run-chip', '.quick-run-chip.active',
    '.quick-run-results', '.quick-run-result', '.quick-run-icon', '.quick-run-icon-folder',
    '.quick-run-icon-shortcut', '.quick-run-icon-link', '.quick-run-icon-layout-item', '.quick-run-name',
    '.quick-run-breadcrumb', '.quick-run-cap', '.quick-run-notice',
  ];
  for (const selector of painted) {
    assert.ok(css.includes(`\n${selector} `) || css.includes(`\n${selector} {`) || css.includes(`\n${selector},`), `${selector} has a rule`);
  }
  // The two row markers the surface sets, because they are how the reader sees the keyboard's choice and
  // the pointer's position: data-quick-run-highlighted rides the .highlighted class, and hover is the
  // attribute the surface writes.
  assert.ok(css.includes('.quick-run-result.highlighted'), 'the keyboard highlight has a visible treatment');
  assert.ok(css.includes('[data-quick-run-hovered="true"]'), 'and so does the row under the pointer');
});

test('the stylesheet is theme-driven, so the dark theme is not a second file', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no literal colours: they would not follow the theme');
  assert.doesNotMatch(css, /\brgba?\(/, 'no literal colour functions either');
  assert.doesNotMatch(css, /:\s*(white|black)\b/, 'and no named colours');
  assert.match(css, /var\(--surface-raised\)/, 'surfaces come from the token set');
  assert.match(css, /var\(--selection\)/, 'and so does the highlight');
});

test('the layer can still be hidden: the rule that makes display safe is in place', () => {
  // The layer is a flex column, which would otherwise beat the hidden attribute and leave the palette on
  // screen forever. base.css carries the !important rule that prevents it; if that rule is ever removed,
  // every Quick Run element stays visible and this is the only test that would notice.
  assert.match(baseCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/, 'base.css hides [hidden] with !important');
  assert.match(ruleFor('.quick-run-layer'), /display:\s*flex/, 'and the layer does set its own display, which is why that matters');
});

test('the row icon is one fixed box, with the artwork contained in it', () => {
  // Real per-item artwork must not turn the list into a texture: every row has the same leading box, the
  // picture is contained rather than cropped or stretched, and a row with no artwork keeps that box with the
  // kind's own fill. The box also has to stay inside the row's own min-height, because that row height is
  // what the wheel arithmetic measures when it turns a delta into rows.
  const box = ruleFor('.quick-run-icon');
  assert.match(box, /width:\s*16px/, 'one fixed width for every row');
  assert.match(box, /height:\s*16px/, 'and one fixed height');
  assert.match(box, /justify-content:\s*center/, 'the artwork is centred in the box');
  assert.match(ruleFor('.quick-run-icon-art'), /object-fit:\s*contain/, 'contained, never cropped or stretched');
  assert.match(ruleFor('.quick-run-icon-image'), /border:\s*0/, 'the box is a window, not a tile, behind artwork');

  const row = ruleFor('.quick-run-result');
  const rowMinHeight = Number(row.match(/min-height:\s*(\d+)px/)?.[1] ?? NaN);
  const padding = Number(row.match(/padding:\s*(\d+)px/)?.[1] ?? 0);
  const boxHeight = Number(box.match(/height:\s*(\d+)px/)?.[1] ?? NaN);
  assert.equal(rowMinHeight, QUICK_RUN_WHEEL_ROW_HEIGHT_PX, 'the row is still the height the wheel arithmetic assumes');
  assert.ok(
    boxHeight + padding * 2 <= rowMinHeight,
    `a ${boxHeight}px icon plus the row's padding stays inside the ${rowMinHeight}px row, so artwork cannot change how far a wheel notch travels`,
  );
});
