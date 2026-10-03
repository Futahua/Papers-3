import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFile(path.join(root, name), 'utf8');

/** Recursively collects every .js file under the public/ directory. */
async function listPublicJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listPublicJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('the local project owns its exact interface, pickup prompt and prepared actions', async () => {
  const [manifest, actions, html] = await Promise.all([
    read('project.json').then(JSON.parse),
    read('actions.json').then(JSON.parse),
    read('public/workspace-20260730b.html'),
  ]);

  // Entry-point contract: the manifest points at the static HTML entry.
  assert.equal(manifest.backpackId, 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d');
  assert.equal(manifest.entry, 'public/workspace-20260730b.html');

  // Prepared actions: exact stable set, and each target must resolve here.
  assert.deepEqual(
    actions.actions.map(({ id }) => id),
    ['clips', 'sloptop-mode', 'slop-engine', 'usb'],
  );
  for (const action of actions.actions) {
    assert.equal(path.isAbsolute(action.target), true);
    await access(action.target);
  }

  // Security boundary: scripts stay local and may never use unsafe-inline or
  // unsafe-eval. Inline CSS remains allowed because Papers' own project CSP
  // already permits it and nested srcdoc previews inherit the project CSP.
  const csp = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
  assert.ok(csp, 'a Content-Security-Policy meta tag is required');
  assert.match(csp[1], /script-src\s+'self'/i);
  const scriptSrc = csp[1].split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src ')) ?? '';
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'|'unsafe-eval'/i);
  assert.doesNotMatch(csp[1], /'unsafe-eval'/i);
  assert.match(csp[1], /style-src\s+'self'\s+'unsafe-inline'/i);
  assert.match(html, /<script type="module" src="workspace-20260730b\.js(\?build=[^"]+)?"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="workspace-20260730b\.css(\?build=[^"]+)?" \/>/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/i);

  // Accessibility landmarks and the interactive surfaces the app drives.
  assert.match(html, /id="icon-grid"/);
  assert.match(html, /aria-label="Items in this folder"/);
  assert.match(html, /data-view="graph"/);
  assert.match(html, /data-context-menu/);
  assert.match(html, /data-bin-view/);
  assert.match(html, /id="delete-all-bin"/);
  assert.match(html, /id="restore-all-bin"/);
  assert.match(html, /id="save-editor"/);
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /id="link-edit-layer"/);
  assert.match(html, /id="confirm-restore"/);
  assert.match(html, /toolbar-float/);
  assert.match(html, /data-toolbar-drag-handle/);
  assert.doesNotMatch(html, /<button[^>]+data-toolbar-key=/);
  assert.doesNotMatch(html, /data-toolbar-key="breadcrumbs"/);
  assert.match(html, /icon-button/);

  // Required host protocol names must be present in the shipped JS — they
  // may move between modules as the workspace is split up, so scan the whole
  // public/ tree rather than pinning any single file.
  const jsFiles = await listPublicJsFiles(path.join(root, 'public'));
  const allJs = (await Promise.all(jsFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  for (const protocol of [
    'papers:project:as-you-go-load',
    'papers:project:as-you-go-save',
    'papers:project:as-you-go-launch',
    'papers:project:as-you-go-reveal',
    'papers:project:as-you-go-pick-target',
    'papers:project:as-you-go-shortcut-icon',
    'papers:project:resolve-web-link-icon',
    'papers:project:resolve-dropped-targets',
    'papers:project:open-web-link',
  ]) {
    assert.ok(allJs.includes(protocol), `missing host protocol: ${protocol}`);
  }

  // The agent pickup prompt stays part of this project's interface.
  assert.match(allJs, /Backpack interfaces, behavior, and implementation belong outside Papers/);
  assert.match(allJs, /My request:\r?\n\[Describe what you want to experience\.\]/);
});

test('the entry composes the command layer after its graph and closeMenu consts', async () => {
  const script = await read('public/workspace-20260730b.js');
  const commandsIndex = script.indexOf('const commands = createWorkspaceCommands');
  const graphIndex = script.indexOf('const graph = createGraphController');
  const closeMenuIndex = script.indexOf('const closeMenu = () => menu.closeMenu()');
  assert.ok(graphIndex >= 0, 'graph controller declaration present');
  assert.ok(closeMenuIndex >= 0, 'closeMenu shim present');
  // createWorkspaceCommands evaluates graph and closeMenu as argument values,
  // so constructing it before those consts are initialized would throw a
  // temporal-dead-zone error at module load. Guard the init ordering.
  assert.ok(commandsIndex > graphIndex, 'commands constructed after graph');
  assert.ok(commandsIndex > closeMenuIndex, 'commands constructed after closeMenu');
});

test('the stylesheet entry aggregates local files in a stable order', async () => {
  const entry = await read('public/workspace-20260730b.css');
  const imports = [...entry.matchAll(/@import url\('\.\/styles\/([^']+)\.css'\);/g)]
    .map((match) => match[1]);
  const expected = [
    'tokens', 'base', 'workspace', 'toolbar', 'items', 'file-capability', 'navigator', 'graph', 'quick-run',
    'context-menu', 'dialogs', 'utilities', 'responsive',
  ];
  assert.deepEqual(imports, expected, 'entry @imports must list every style file in order');

  // Every imported file must exist locally (no remote or missing stylesheets).
  const concatenated = (await Promise.all(
    imports.map((name) => read(`public/styles/${name}.css`)),
  )).join('\n');

  // Required interaction selectors must survive the split unchanged.
  for (const selector of [
    '.graph-dragging', '.graph-drop-target', '.will-pin', '.will-release',
    '.icon-item.selected', '.drop-inside', '.bin-canvas', '.bin-button',
    '.editor-layer', '.confirm-layer', '.context-menu', '.toolbar-float',
    '.selection-marquee', '.selection-status', '.breadcrumbs',
  ]) {
    assert.ok(concatenated.includes(selector), `missing interaction selector: ${selector}`);
  }
});

test('every coordinator name the entry uses is imported (no dead reference)', async () => {
  // A used-but-unimported name throws ReferenceError when that line runs.
  // Inside startSurfaceCoordination it leaves coordination unsettled forever
  // and every save refusing behind the settle poll, while unit suites import
  // modules directly and never execute the entry. This scan is the guard.
  const [entry, coordinator] = await Promise.all([
    read('public/workspace-20260730b.js'),
    read('public/app/workspace-surface-coordinator.js'),
  ]);
  const block = entry.match(/import \{([^}]*)\} from '\.\/app\/workspace-surface-coordinator\.js[^']*';/);
  assert.ok(block, 'entry coordinator import block present');
  const imported = new Set(block[1].split(',').map((name) => name.trim()).filter(Boolean));
  const exported = [...coordinator.matchAll(/export (?:const|function|class) ([A-Za-z0-9_]+)/g)]
    .map((match) => match[1]);
  assert.ok(exported.length > 0, 'coordinator exports names');
  const word = (text, name) => new RegExp(`\\b${name}\\b`).test(text);
  const entryWithoutImports = entry.replace(/import \{[^}]*\} from '[^']*';/g, '');
  for (const name of exported) {
    if (word(entryWithoutImports, name)) {
      assert.ok(imported.has(name), `entry uses ${name} but does not import it from the coordinator`);
    }
  }
  for (const name of imported) {
    assert.ok(exported.includes(name), `entry imports ${name} but coordinator does not export it`);
  }
});

test('every direct store save carries metadata so background saves rebase instead of freezing', async () => {
  // A background save (rest positions, surface locations, icon and card
  // sizes) that loses a CAS race with a peer commit must rebase once, not
  // freeze the surface into CONFLICT with refresh disabled. Only explicit
  // creator saves may freeze. The coordinator rebases saves flagged with
  // rebaseAutomaticSave; explicit paths pass metadata through instead.
  const script = await read('public/workspace-20260730b.js');
  const calls = [...script.matchAll(/store\.save\(([^)]*)\)/g)].map((match) => match[1]);
  assert.ok(calls.length > 0, 'entry has direct store saves');
  for (const args of calls) {
    assert.ok(args.includes(','), `store.save(${args}) must carry metadata`);
  }
});

test('every folder expander render path stars the scope root', async () => {
  // The graph has two tile markup paths (create and update). Starring only
  // one leaves the other drawing a plain chevron for project roots forever,
  // and no unit suite executes either path. Both must branch on scopeRoot.
  const script = await read('public/workspace-20260730b.js');
  const renderers = script.split('\n').filter((line) => line.includes('folder-expander ${'));
  assert.ok(renderers.length >= 2, 'both tile markup paths present');
  for (const line of renderers) {
    assert.ok(line.includes('scope-expander'), 'expander markup must handle the scope root');
  }
});
