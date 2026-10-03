import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const graphCss = readFileSync(new URL('./public/styles/graph.css', import.meta.url), 'utf8');
const dialogCss = readFileSync(new URL('./public/styles/dialogs.css', import.meta.url), 'utf8');
const toolbarCss = readFileSync(new URL('./public/styles/toolbar.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('./public/styles/tokens.css', import.meta.url), 'utf8');
const itemsCss = readFileSync(new URL('./public/styles/items.css', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('./public/styles/base.css', import.meta.url), 'utf8');

test('graph node shells have a bounded width so long names wrap', () => {
  const shellRule = graphCss.match(/\.graph-node-shell\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(
    !/\bwidth:\s*max-content\b/.test(shellRule),
    'shell width must not be content-sized (that leaves no wrapping boundary)',
  );
  assert.ok(
    /\bwidth:\s*clamp\(/.test(shellRule),
    'shell width must be a finite clamp derived from the icon size',
  );
});

test('graph node labels wrap spaced names and break unbroken words', () => {
  assert.ok(/\bwhite-space:\s*normal\b/.test(graphCss), 'labels must wrap onto lines');
  assert.ok(
    /\boverflow-wrap:\s*anywhere\b/.test(graphCss),
    'labels must break long unbroken words',
  );
  assert.ok(/\bword-break:\s*break-word\b/.test(graphCss), 'labels must break long words');
  assert.ok(
    /\.graph-node-shell \.icon-item\b/.test(graphCss),
    'the wrap rules must be scoped to graph node labels',
  );
});

test('collapsed prompt-tree rows are not text-selectable', () => {
  const rowRule = dialogCss.match(/\.prompt-tree-row\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(
    /user-select:\s*none/.test(rowRule),
    'row labels must not be selectable: drag-selecting text fights row selection and drag',
  );
});

test('prompt editors opt back into text selection', () => {
  const editorRule = dialogCss.match(
    /\.prompt-card-title,\s*\.prompt-card-text,\s*\.prompt-folder-rename\s*\{[^}]*\}/,
  )?.[0] ?? '';
  assert.ok(
    /user-select:\s*text/.test(editorRule),
    'title, body and rename inputs must stay selectable for normal text editing',
  );
});

test('folder exclude-all renders as a red box with a minus, not a green check', () => {
  const boxRule = dialogCss.match(
    /\.prompt-folder-checkbox\[data-batch-state="exclude"\]\s*\{[^}]*\}/,
  )?.[0] ?? '';
  assert.ok(/appearance:\s*none/.test(boxRule), 'the box must be drawn, not left as a native check');
  assert.ok(/background:\s*var\(--danger\)/.test(boxRule), 'exclude must read red, distinct from the green accent');
  const minusRule = dialogCss.match(
    /\.prompt-folder-checkbox\[data-batch-state="exclude"\]::after\s*\{[^}]*\}/,
  )?.[0] ?? '';
  assert.ok(/content:\s*""/.test(minusRule), 'a minus bar must be drawn inside the box');
});

test('rows under a folder override take that override colour', () => {
  assert.ok(
    /\.prompt-batch-include \.prompt-prompt-title/.test(dialogCss),
    'descendants of an included folder must read green',
  );
  assert.ok(
    /\.prompt-batch-exclude \.prompt-prompt-title/.test(dialogCss),
    'descendants of an excluded folder must read red',
  );
});

test('workspace warnings are overlay toasts with a fade state', () => {
  const statusRule = toolbarCss.match(/\.status\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/position:\s*fixed/.test(statusRule), 'warnings overlay the workspace instead of taking layout space');
  assert.ok(/width:\s*max-content/.test(statusRule), 'the popup wraps its message rather than becoming a full-width bar');
  assert.ok(/pointer-events:\s*none/.test(statusRule), 'a transient warning cannot block workspace controls');
  assert.ok(/opacity:\s*0\.5/.test(statusRule), 'the whole popup pill is 50% opaque');
  const fadingRule = toolbarCss.match(/\.status\.status-fading\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*0/.test(fadingRule), 'the dismissal has a visible fade state');
});

test('graph connector opacity is controlled by one container variable with the accepted default', () => {
  const edgeRule = graphCss.match(/\.graph-edge\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*var\(--graph-edge-opacity,\s*\.5\)/.test(edgeRule));
});

test('set outlines and named-set glyphs share outline opacity, while selected regions stay stronger', () => {
  const outlineRule = graphCss.match(/\.graph-set-outline\s*\{[^}]*\}/)?.[0] ?? '';
  const glyphRule = graphCss.match(/\.graph-set-glyphs\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*var\(--graph-outline-opacity,\s*1\)/.test(outlineRule));
  assert.ok(/opacity:\s*var\(--graph-outline-opacity,\s*1\)/.test(glyphRule), 'named set glyphs follow outline opacity');
  const baseRegion = graphCss.match(/\.graph-set-region\s*\{[^}]*\}/)?.[0] ?? '';
  const selectedRegion = graphCss.match(/\.graph-set-region\.region-selected\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/calc\(12% \* var\(--graph-region-opacity,\s*1\)\)/.test(baseRegion));
  assert.ok(/calc\(24% \* var\(--graph-region-opacity,\s*1\)\)/.test(selectedRegion), 'selected fill remains 2x the base strength');
});

test('settings visual controls share a five-column layout and wrap on narrow panels', () => {
  const rule = dialogCss.match(/\.settings-preferences\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(rule));
  assert.ok(/@media\s*\(max-width:\s*560px\)/.test(dialogCss));
});

test('dark theme defines a warm palette and preserves the accent picking ladder', () => {
  assert.match(tokensCss, /:root\[data-theme="dark"\]/);
  assert.match(tokensCss, /--page-background:\s*#201e1a/);
  const dark = tokensCss.slice(tokensCss.indexOf(':root[data-theme="dark"]'));
  for (const token of ['--accent-wash-faint', '--accent-wash-partial', '--accent-fill-selected', '--accent-stroke-soft', '--accent-stroke-partial', '--accent-stroke-selected', '--item-accent-wash']) {
    assert.match(dark, new RegExp(`${token}:`));
  }
  assert.notEqual(dark.match(/--accent-wash-faint:\s*[^;]+/)?.[0], dark.match(/--accent-fill-selected:\s*[^;]+/)?.[0]);
});

test('shortcut and folder artwork remains unfiltered and unrecoloured', () => {
  const iconRule = itemsCss.match(/\.item-icon img\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(iconRule, 'the artwork rule must remain explicit');
  assert.doesNotMatch(iconRule, /filter\s*:|opacity\s*:|mix-blend-mode\s*:/);
  assert.doesNotMatch(itemsCss, /\.item-icon\s+img[^}]*\bfilter\s*:/);
});

test('workspace body uses a plain page surface without a square grid', () => {
  const bodyRule = baseCss.match(/body\s*\{(?=[^}]*min-height:\s*100vh)[^}]*\}/)?.[0] ?? '';
  assert.match(bodyRule, /background:\s*var\(--page-background\)/);
  assert.doesNotMatch(bodyRule, /linear-gradient|background-size/);
});

test('transparent background opt-in overrides page surface without changing dark tokens', () => {
  assert.match(tokensCss, /:root\[data-transparent-background="true"\]/);
  assert.match(tokensCss, /--page-background:\s*transparent/);
  assert.match(graphCss, /\.graph-set-region\s*\{[^}]*color-mix/);
  assert.match(itemsCss, /\.icon-item/);
});

test('floating surfaces use theme variables, including the breadcrumb handle', () => {
  const breadcrumbRule = [...toolbarCss.matchAll(/\.breadcrumbs(?:-retired)?\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .find((rule) => /background:\s*var\(--paper\)/.test(rule)) ?? '';
  assert.match(breadcrumbRule, /background:\s*var\(--paper\)/);
  for (const source of [toolbarCss, dialogCss]) {
    assert.doesNotMatch(source, /background:\s*#[0-9a-f]{3,8}\b/i, 'floating surfaces must not hide literal light backgrounds');
  }
});

test('prompt settings is a full page with peer navigation and create actions', () => {
  const pageRule = dialogCss.match(/\.prompt-settings-page\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(pageRule, /position:\s*fixed/);
  assert.match(pageRule, /inset:\s*0/);
  assert.match(pageRule, /background:\s*var\(--surface-raised\)/);
  const libraryRule = dialogCss.match(/\.prompt-library\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(libraryRule, /width:\s*100%/);
  assert.match(libraryRule, /height:\s*100%/);
  assert.match(libraryRule, /border:\s*0/);
  assert.match(libraryRule, /box-shadow:\s*none/);
  const headerRule = dialogCss.match(/\.prompt-library-header\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/border-bottom:\s*1px solid/.test(headerRule), 'tabs get a dedicated header boundary');
  const tabsRule = dialogCss.match(/\.prompt-library-tabs\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/background:\s*var\(--surface-muted\)/.test(tabsRule), 'tabs have a navigation treatment');
  const actionRule = dialogCss.match(/\.prompt-library-add-actions\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(actionRule, /margin:\s*0 0 0 auto/, 'create actions share the header row');
  assert.match(actionRule, /border:\s*0/, 'create actions do not form a second card or toolbar');
});

test('expanded prompt bodies stay resizable without a visible native grip', () => {
  const textRule = dialogCss.match(/\.prompt-card-text\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(textRule, /resize:\s*vertical/);
  const resizerRule = dialogCss.match(/\.prompt-card-text::\-webkit-resizer\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(resizerRule, /background:\s*transparent/);
});

test('prompt page content is borderless and uses surface-coloured scrollbars', () => {
  const preferencesRule = dialogCss.match(/\.settings-preferences\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(preferencesRule, /border:\s*0/);
  const viewportRule = dialogCss.match(/\.prompt-tree-viewport\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(viewportRule, /border:\s*0/);
  assert.match(dialogCss, /scrollbar-color:[^;]*var\(--surface-raised\)/);
  assert.match(dialogCss, /::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*color-mix/s);
});

test('trail tiles fade through the existing Trail opacity variable, without animation', () => {
  // Assignment 005: the whole derived trail branch (ancestors plus expanded
  // descendants) is styled via .trail-item and the existing
  // --graph-trail-opacity preference. Static per-tile value — no transition,
  // no animation, no new colour or preference.
  const trailRule = itemsCss.match(/\.icon-item\.trail-item\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*var\(--graph-trail-opacity,\s*1\)/.test(trailRule),
    'the trail tile rule must use the existing trail opacity variable');
  assert.doesNotMatch(trailRule, /transition|animation/, 'no timed visual change');
  assert.doesNotMatch(itemsCss, /\.icon-item\.ancestor-item\s*\{[^}]*opacity/,
    'opacity moved off the ancestor-only class onto trail-item');
});

test('019F: member state is a bottom running indicator, not a top-right dot', () => {
  const stateRule = itemsCss.match(/\.window-layout-member-state\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(stateRule, /\bbottom:\s*0\b/, 'the running indicator sits at the bottom');
  assert.match(stateRule, /\bheight:\s*2px\b/, 'the indicator is a short line, not a dot');
  assert.doesNotMatch(stateRule, /\bright:\s*1px\b/, 'no top-right corner dot');
  assert.doesNotMatch(stateRule, /border-radius:\s*50%/, 'no round dot');
  assert.match(stateRule, /left:\s*50%/, 'the line is centered under the icon');
});

test('019F: member icons are centered and never filtered/recolored', () => {
  const memberRule = itemsCss.match(/\.window-layout-member\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(memberRule, /justify-content:\s*center/, 'the icon is centered horizontally');
  assert.match(memberRule, /align-items:\s*center/, 'the icon is centered vertically');
  const iconRule = itemsCss.match(/\.window-layout-member-icon\s*\{[^}]*\}/)?.[0] ?? '';
  assert.doesNotMatch(iconRule, /filter|mix-blend-mode|-webkit-filter/, 'native artwork must never be filtered/recolored');
  assert.match(iconRule, /object-fit:\s*contain/, 'artwork is contained, not stretched');
});

test('019F: member hover/selection use a subtle rounded background and accent only for selection', () => {
  const hoverRule = itemsCss.match(/\.window-layout-member:hover\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(hoverRule, /background:\s*var\(--surface-soft\)/, 'static rounded hover background');
  assert.doesNotMatch(hoverRule, /transition|animation/, 'no animated hover');
  const selectedRule = itemsCss.match(/\.window-layout-member\.selected\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(selectedRule, /background:\s*var\(--surface-soft\)/, 'subtle selected background');
  assert.match(selectedRule, /var\(--folder-color/, 'accent ring only for explicit selection');
  const indicatorAccent = itemsCss.match(/\.window-layout-member\.selected \.window-layout-member-state\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(indicatorAccent, /background:\s*var\(--folder-color/, 'accent indicator only for explicit selection');
  assert.doesNotMatch(indicatorAccent, /var\(--success/, 'no green foreground-active claim');
});

test('019F/033/034/035/036 C4: member strip wraps with the available width up to ONE compact width bound - every member visible, no count cap, no clipping, no long strip', () => {
  const stripRule = itemsCss.match(/\.window-layout-members\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(stripRule, /flex-wrap:\s*wrap/, 'bounded wrapping, every member visible');
  assert.match(stripRule, /overflow-x:\s*visible/, 'no clipping');
  assert.match(stripRule, /overflow-y:\s*visible/, 'rows reflow without clipping');
  assert.doesNotMatch(stripRule, /gap:\s*\d+px\s+\d+px/, 'uniform gap, no window grouping');
  // 036: the card fills its host width up to the ONE compact width bound
  // (measurement-driven WIDTH bound shared by attached + detached; never a
  // count-based breakpoint and never an unbounded strip).
  assert.match(itemsCss, /\.window-layout-card\s*\{[^}]*width:\s*100%/);
  assert.match(itemsCss, /\.window-layout-card\s*\{[^}]*max-width:\s*min\(100%, var\(--wl-card-max-width/);
  assert.match(itemsCss, /\.icon-grid > \.window-layout-card \.window-layout-body,[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(stripRule, /width:\s*var\(--wl-balanced-member-width/, 'live width chooses balanced rows');
  assert.doesNotMatch(itemsCss, /\.window-layout-member:nth-child/);
});

test('tracking toggle reserves only its own corner footprint', () => {
  const cornerRule = itemsCss.match(/\.icon-grid > \.window-layout-card:has\(\.wl-tracking\)\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(cornerRule, /padding-bottom:\s*22px/, 'no dead band remains below the action row');
  const toggleRule = itemsCss.match(/\.icon-grid > \.window-layout-card \.wl-tracking\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(toggleRule, /bottom:\s*4px/, 'toggle remains inset into the lower-right corner');
});

test('widget delete affordance is top-right and revealed only at its own hover target', () => {
  const buttonRule = itemsCss.match(/\.window-layout-delete\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(buttonRule, /right:\s*3px/, 'delete button is anchored at the card top-right');
  assert.doesNotMatch(buttonRule, /left:/, 'delete button is not anchored on the left');
  assert.match(buttonRule, /opacity:\s*0/, 'delete starts hidden');
  assert.match(buttonRule, /pointer-events:\s*auto/, 'its exact invisible footprint remains hoverable');
  assert.match(itemsCss, /\.window-layout-delete:hover,\s*\.window-layout-delete:focus-visible\s*\{[^}]*opacity:\s*1/,
    'only hovering or keyboard-focusing the button reveals it');
  assert.doesNotMatch(itemsCss, /\.window-layout-card:hover\s+\.window-layout-delete/,
    'hovering elsewhere on the widget does not reveal the button');
});
