/**
 * WHICH PROJECT ALT+A LAUNCHES, AND WHAT A SECOND PRESS DOES.
 *
 * The reported defect, reproduced and pinned down: with a project that declares
 * no command surface as the front tab, Alt+A rendered THAT project into the
 * launcher's 640x220 letterbox. The creator presses the chord from outside
 * Papers, so the front tab is invisible to them.
 *
 * This runs a real Papers with two real bound projects:
 *   - `MUTE`     models Proxima: a working project that declares NO command
 *                surface. It is the ACTIVE tab, exactly as reported.
 *   - `LAUNCHER` models the project that declares one.
 *
 * The chord's own open path is triggered through the test seam
 * (PAPERS_TEST_INVOKE_CHANNEL=1) rather than by synthesising the accelerator:
 * SendInput would seize the keyboard of the machine the creator is sitting at.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';

import { launchPapers, waitFor } from './helpers';

const MUTE = 'bp-11111111-1111-4111-8111-111111111111';
const LAUNCHER = 'bp-22222222-2222-4222-8222-222222222222';
const OVERLAY = { width: 640, height: 220 };

/**
 * The page the launcher should render.
 *
 * The script is an EXTERNAL asset on purpose. The project CSP is
 * `script-src <project origin>` with no `'unsafe-inline'`, so an inline script is
 * refused - which is the same wall an earlier attempt at this fixture hit, and it
 * looks exactly like "the invoke never arrived". That refusal is correct host
 * behaviour and the fixture has to respect it.
 */
const LAUNCHER_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Launcher</title></head>
<body style="margin:0;font:13px system-ui">
  <input id="line" autofocus>
  <span id="state">fresh</span>
  <script src="./record.js"></script>
</body></html>`;

const RECORD_JS = `
window.__invokes = [];
window.addEventListener('papers:project:command-surface-invoke', function () {
  window.__invokes.push(Date.now());
  document.getElementById('state').textContent = 'invoked';
  var line = document.getElementById('line');
  if (line) { line.value = ''; line.focus(); }
});

/**
 * Ask the host for a project channel, the way the real launcher does, and record
 * the ANSWER rather than only whether one arrived. A refused channel answers with
 * the guard's own message, which is what made the reported defect visible in the
 * installed build in the first place.
 */
window.__ask = function (type, extra) {
  return new Promise(function (resolve) {
    var requestId = 'ask-' + Math.random().toString(36).slice(2);
    function onResult(event) {
      if (!event.data || event.data.type !== 'papers:host:result') return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener('message', onResult);
      resolve(event.data);
    }
    window.addEventListener('message', onResult);
    var request = Object.assign({ type: type, requestId: requestId }, extra || {});
    window.postMessage(request, location.origin);
    setTimeout(function () { resolve({ type: 'timeout' }); }, 4000);
  });
};
`;

interface Fixture {
  profile: string;
  data: string;
}

/** Two bound Projects. `LAUNCHER` is the only one that declares a surface. */
async function twoProjectProfile(prefix: string): Promise<Fixture> {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const data = path.join(profile, 'PapersData');
  const backpacks = [MUTE, LAUNCHER].map((id, index) => ({
    id,
    name: index === 0 ? 'Mute Board' : 'Launcher Board',
    type: 'environment',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  }));

  const projects: Record<string, { root: string }> = {};
  for (const [index, backpack] of backpacks.entries()) {
    const root = path.join(profile, backpack.id);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.mkdir(path.join(data, 'backpacks', backpack.id), { recursive: true });
    const manifest: Record<string, unknown> = {
      schemaVersion: 1,
      backpackId: backpack.id,
      entry: 'public/index.html',
    };
    // ONLY the second project STATES that it has a command surface. The first is
    // a fully working project that simply does not - it must never be rendered
    // into the launcher.
    if (index === 1) manifest['launcherSurface'] = 'command-surface';
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify(manifest));
    await fs.writeFile(
      path.join(root, 'public/index.html'),
      index === 1 ? LAUNCHER_PAGE : '<h1>Mute Board</h1>',
    );
    // A real project ships its actions beside its manifest, and the project
    // channels read them. Without this the fixture answers a genuine host-side
    // "could not be read" - which looks like a gate refusal and is not.
    await fs.writeFile(
      path.join(root, 'actions.json'),
      JSON.stringify({ schemaVersion: 1, actions: [{ id: 'any-item', target: 'npm run item' }] }),
    );
    await fs.writeFile(
      path.join(root, 'state.json'),
      JSON.stringify({ schemaVersion: 1, groups: [], shortcuts: [] }),
    );
    if (index === 1) await fs.writeFile(path.join(root, 'public/record.js'), RECORD_JS);
    await fs.writeFile(
      path.join(data, 'backpacks', backpack.id, 'backpack.json'),
      JSON.stringify({ schemaVersion: 1, ...backpack }),
    );
    projects[backpack.id] = { root };
  }
  await fs.writeFile(
    path.join(data, 'registry.json'),
    JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }),
  );
  await fs.writeFile(
    path.join(data, 'backpack-projects.json'),
    JSON.stringify({ schemaVersion: 1, projects }),
  );
  return { profile, data };
}

/** Fire the launcher's own open path and read its typed outcome. */
async function press(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
): Promise<{ ok: boolean; detail: string }> {
  return app.evaluate(async (electron) => {
    const seam = (globalThis as unknown as Record<string, unknown>)['__papersTestOpenCommandSurface'];
    if (typeof seam !== 'function') {
      throw new Error(
        'the launcher test seam is absent; launch with testInvokeChannel: true',
      );
    }
    void electron;
    return (seam as () => Promise<{ ok: boolean; detail: string }>)();
  }, null) as unknown as Promise<{ ok: boolean; detail: string }>;
}

/**
 * The overlay, found by what it LOADS rather than by its pixel size.
 *
 * Two earlier probes were wrong and both failed silently, which is exactly the
 * kind of check that looks like a product failure and is not: a size-only match,
 * and an assumption that the project renders into a CHILD WebContentsView. The
 * launcher loads the project into the window's own webContents, so both shapes
 * are searched.
 */
async function overlayInfo(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
): Promise<{ url: string; invokes: number[] | null; text: string | null } | null> {
  return app.evaluate(async ({ BaseWindow }) => {
    const probe = async (contents: Electron.WebContents): Promise<string | null> => {
      if (!contents || contents.isDestroyed()) return null;
      try {
        return await contents.executeJavaScript(
          'JSON.stringify({ url: location.href, invokes: window.__invokes ?? null, text: document.getElementById("line")?.value ?? null })',
          true,
        ) as string;
      } catch {
        return null;
      }
    };
    for (const win of BaseWindow.getAllWindows()) {
      const candidates: Electron.WebContents[] = [];
      // The launcher is a BrowserWindow and renders the project into its OWN
      // webContents; other Papers windows render into child views. Both shapes
      // are searched, decided by what the window has rather than by assuming
      // one of them - an assumption here silently skipped the launcher.
      const own = (win as unknown as { webContents?: Electron.WebContents }).webContents;
      if (own) candidates.push(own);
      for (const child of win.contentView.children) {
        const view = child as Electron.WebContentsView;
        try { if (view.webContents) candidates.push(view.webContents); } catch { /* gone */ }
      }
      for (const contents of candidates) {
        const raw = await probe(contents);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { url: string; invokes: number[] | null; text: string | null };
        if (!parsed.url.includes('papers-surface=command-surface')) continue;
        return parsed;
      }
    }
    return null;
  });
}

/**
 * Press the chord and observe the overlay in the same breath.
 *
 * Returns the first observation that saw the launcher. `null` when the overlay
 * closed before it could be read, which is reported rather than mistaken for a
 * wrong target.
 */
async function pressAndObserve(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
): Promise<{
  result: { ok: boolean; detail: string };
  overlay: { url: string; invokes: number[] | null; text: string | null } | null;
}> {
  return app.evaluate(async ({ BaseWindow }) => {
    const seam = (globalThis as unknown as Record<string, unknown>)['__papersTestOpenCommandSurface'];
    if (typeof seam !== 'function') throw new Error('the launcher test seam is absent');
    const result = await (seam as () => Promise<{ ok: boolean; detail: string }>)();

    const read = async (contents: Electron.WebContents): Promise<string | null> => {
      if (!contents || contents.isDestroyed()) return null;
      try {
        return await contents.executeJavaScript(
          'JSON.stringify({ url: location.href, invokes: window.__invokes ?? null, text: document.getElementById("line")?.value ?? null })',
          true,
        ) as string;
      } catch {
        return null;
      }
    };
    const sample = async (): Promise<{ url: string; invokes: number[] | null; text: string | null } | null> => {
      for (const win of BaseWindow.getAllWindows()) {
        const candidates: Electron.WebContents[] = [];
        // The launcher is a BrowserWindow and renders the project into its OWN
      // webContents; other Papers windows render into child views. Both shapes
      // are searched, decided by what the window has rather than by assuming
      // one of them - an assumption here silently skipped the launcher.
      const own = (win as unknown as { webContents?: Electron.WebContents }).webContents;
      if (own) candidates.push(own);
        for (const child of win.contentView.children) {
          const view = child as Electron.WebContentsView;
          try { if (view.webContents) candidates.push(view.webContents); } catch { /* gone */ }
        }
        for (const contents of candidates) {
          const raw = await read(contents);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as { url: string; invokes: number[] | null; text: string | null };
          if (parsed.url.includes('papers-surface=command-surface')) return parsed;
        }
      }
      return null;
    };

    // Poll as tightly as the event loop allows, and keep the LAST real
    // observation. The overlay tears down on blur - correct host behaviour - and
    // on an unattended machine that can happen before its page has finished
    // loading. At the creator's desk the launcher IS the focused window and
    // stays up. Losing the race must be reported as "did not observe it", never
    // mistaken for "it targeted the wrong project".
    let last: { url: string; invokes: number[] | null; text: string | null } | null = null;
    const deadline = Date.now() + 3000;
    for (;;) {
      const seen = await sample();
      if (seen) {
        last = seen;
        if (seen.invokes !== null) return { result, overlay: seen };
      }
      if (Date.now() > deadline) return { result, overlay: last };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/**
 * Put the app's own window in front and focused.
 *
 * The overlay tears itself down on blur - correct host behaviour - so an
 * unattended test machine that leaves focus elsewhere can close the launcher the
 * instant it opens. At the creator's desk the launcher IS the focused window, so
 * the test has to reproduce that rather than observe a state nobody is ever in.
 */
async function focusAppWindow(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
): Promise<void> {
  await app.evaluate(async ({ BaseWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      try {
        win.show();
        win.focus();
      } catch { /* not focusable */ }
    }
  });
}

/**
 * Ask the launcher page to exercise a host project channel and return the
 * answer the host gave. This is the check that the reported defect would fail:
 * `state-load` used to answer `ok: false` with "host channel called from
 * non-host sender".
 */
async function askOverlay(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
  type: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok?: boolean; error?: string; state?: string; type?: string }> {
  return app.evaluate(async ({ BaseWindow }, payload) => {
    const candidates: Electron.WebContents[] = [];
    for (const win of BaseWindow.getAllWindows()) {
      const own = (win as unknown as { webContents?: Electron.WebContents }).webContents;
      if (own) candidates.push(own);
      for (const child of win.contentView.children) {
        const view = child as Electron.WebContentsView;
        try { if (view.webContents) candidates.push(view.webContents); } catch { /* gone */ }
      }
    }
    for (const contents of candidates) {
      if (!contents || contents.isDestroyed()) continue;
      let url = '';
      try { url = contents.getURL(); } catch { continue; }
      if (!url.includes('papers-surface=command-surface')) continue;
      const raw = await contents.executeJavaScript(
        `window.__ask(${JSON.stringify(payload.type)}, ${JSON.stringify(payload.extra)})`,
        true,
      );
      return raw as { ok?: boolean; error?: string; state?: string; type?: string };
    }
    throw new Error('the launcher surface is not open');
  }, { type, extra });
}

/**
 * Wait until the launcher page has registered its invoke listener.
 *
 * The host delivers the invoke as soon as `loadURL` resolves. Whether a fixture
 * page's own listener exists by then is the fixture's business - the real
 * project has been loaded before the chord is pressed - so the test waits for the
 * stand-in to be as ready as the real one, instead of calling a lost event a
 * product defect.
 */
async function waitForLauncherListener(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const state = await overlayInfo(app);
    if (state && Array.isArray(state.invokes)) return;
    if (Date.now() > deadline) throw new Error('the launcher page never registered its invoke listener');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function setOverlayText(
  app: Awaited<ReturnType<typeof launchPapers>>['app'],
  value: string,
): Promise<void> {
  await app.evaluate(async ({ BaseWindow }, text) => {
    const candidates: Electron.WebContents[] = [];
    for (const win of BaseWindow.getAllWindows()) {
      // The launcher is a BrowserWindow and renders the project into its OWN
      // webContents; other Papers windows render into child views. Both shapes
      // are searched, decided by what the window has rather than by assuming
      // one of them - an assumption here silently skipped the launcher.
      const own = (win as unknown as { webContents?: Electron.WebContents }).webContents;
      if (own) candidates.push(own);
      for (const child of win.contentView.children) {
        const view = child as Electron.WebContentsView;
        try { if (view.webContents) candidates.push(view.webContents); } catch { /* gone */ }
      }
    }
    for (const contents of candidates) {
      if (!contents || contents.isDestroyed()) continue;
      if (!contents.getURL().includes('papers-surface=command-surface')) continue;
      await contents.executeJavaScript(
        `document.getElementById("line").value = ${JSON.stringify(text)}`,
        true,
      );
      return;
    }
  }, value);
}

it('Alt+A launches the declared command surface even when that project is not open', async () => {
  const { profile } = await twoProjectProfile('papers-launcher-target-');
  const launched = await launchPapers(profile, { fixtures: false, testInvokeChannel: true });
  try {
    const page = await launched.app.firstWindow();
    const enter = (name: string) =>
      page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: name }) })
        .getByRole('button', { name: 'Enter', exact: true });

    // The only open tab declares NOTHING. The launcher project is bound in the
    // registry but has never been opened in this process.
    await waitFor(async () => await enter('Mute Board').count() === 1, 15000, 'main picker');
    await enter('Mute Board').click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Mute Board' }).count() === 1, 15000, 'mute open');
    await page.waitForTimeout(500);
    await focusAppWindow(launched.app);

    const opened = await press(launched.app);
    expect(opened.ok, opened.detail).toBe(true);

    await waitForLauncherListener(launched.app);
    const ready = await overlayInfo(launched.app);
    expect(ready).not.toBeNull();
    // THE ASSERTION THE OLD CODE FAILED: the closed launcher project is opened
    // on demand, instead of resolving only among already-open tab runtimes.
    expect(ready!.url).toContain(LAUNCHER);
    expect(ready!.url).not.toContain(MUTE);
    expect(ready!.url).toContain('papers-surface=command-surface');

    // The repeat press, which is the half of the second defect the host owns.
    // The window is not rebuilt and the surface is not reloaded, so a typed line
    // is not thrown away by pressing the chord again.
    await setOverlayText(launched.app, 'half-typed query');
    const again = await press(launched.app);
    expect(again.ok).toBe(true);
    expect(again.detail).toContain('already open');

    const second = await overlayInfo(launched.app);
    expect(second).not.toBeNull();
    expect(second!.url).toBe(ready!.url);
    expect(second!.text).toBe('half-typed query');

    // NOT ASSERTED HERE, AND RECORDED SO IT IS NOT MISTAKEN FOR VERIFIED: that
    // the invoke this repeat issues REACHES the page. In this harness the host's
    // send is issued (verified directly, twice) and the overlay preload's relay
    // is registered (verified through the context bridge), yet the page never
    // receives the payload - reproduced with a direct `webContents.send` outside
    // the product path entirely, so it is a property of this automated
    // environment rather than of the launcher. The unit tests cover the host half
    // and say nothing about the wire. Whether the creator's second Alt+A lands on
    // an empty line is NOT established by this round and needs a person at the
    // machine pressing the chord twice.
  } finally {
    await launched.close();
  }
}, 180_000);

it('with no declared command surface open, the launcher refuses and names what it looked at', async () => {
  // ONE project, and it declares nothing: the Proxima case exactly.
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-launcher-refuse-'));
  const data = path.join(profile, 'PapersData');
  const backpack = {
    id: MUTE,
    name: 'Mute Board',
    type: 'environment',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  };
  const root = path.join(profile, MUTE);
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.mkdir(path.join(data, 'backpacks', MUTE), { recursive: true });
  await fs.writeFile(
    path.join(root, 'project.json'),
    JSON.stringify({ schemaVersion: 1, backpackId: MUTE, entry: 'public/index.html' }),
  );
  await fs.writeFile(path.join(root, 'public/index.html'), '<h1>Mute Board</h1>');
  await fs.writeFile(
    path.join(data, 'backpacks', MUTE, 'backpack.json'),
    JSON.stringify({ schemaVersion: 1, ...backpack }),
  );
  await fs.writeFile(
    path.join(data, 'registry.json'),
    JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }),
  );
  await fs.writeFile(
    path.join(data, 'backpack-projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: { [MUTE]: { root } } }),
  );

  const launched = await launchPapers(profile, { fixtures: false, testInvokeChannel: true });
  try {
    const page = await launched.app.firstWindow();
    const enter = () =>
      page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: 'Mute Board' }) })
        .getByRole('button', { name: 'Enter', exact: true });
    await waitFor(async () => await enter().count() === 1, 15000, 'main picker');
    await enter().click();
    await waitFor(
      async () => await page.getByRole('tab', { name: 'Mute Board' }).count() === 1,
      15000,
      'the mute project is open',
    );

    const result = await press(launched.app);

    // Refused...
    expect(result.ok).toBe(false);
    // ...visibly, saying something TRUE: which Backpack was looked at, and that
    // it does not declare a command surface.
    expect(result.detail).toContain(MUTE);
    expect(result.detail).toContain('does not declare a command surface');
    // ...and NOT by rendering the project that has no command surface.
    expect(await overlayInfo(launched.app)).toBeNull();
  } finally {
    await launched.close();
  }
}, 180_000);

it('the launcher can actually reach the project channels it needs, and not the ones it must not', async () => {
  // THE REPORTED DEFECT, driven through the real IPC path in a real Papers.
  // Before this round every one of these answered:
  //   "host channel called from non-host sender"
  // so the launcher had nothing to search, nothing to run and nothing to copy.
  const { profile } = await twoProjectProfile('papers-launcher-channels-');
  const launched = await launchPapers(profile, { fixtures: false, testInvokeChannel: true });
  try {
    const page = await launched.app.firstWindow();
    const enter = (name: string) =>
      page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: name }) })
        .getByRole('button', { name: 'Enter', exact: true });
    await waitFor(async () => await enter('Mute Board').count() === 1, 15000, 'main picker');
    await enter('Mute Board').click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Mute Board' }).count() === 1, 15000, 'mute open');
    await page.locator('.titlebar-left > button').click();
    await waitFor(async () => await enter('Launcher Board').count() === 1, 15000, 'picker again');
    await enter('Launcher Board').click({ button: 'middle' });
    await waitFor(async () => await page.getByRole('tab').count() === 2, 15000, 'both tabs open');
    await page.getByRole('tab', { name: 'Mute Board' }).click();
    await page.waitForTimeout(500);
    await focusAppWindow(launched.app);

    const pressed = await pressAndObserve(launched.app);
    expect(pressed.overlay).not.toBeNull();
    await waitForLauncherListener(launched.app);

    // The read the creator's launcher needs to have anything to search. The
    // error is asserted BEFORE the outcome so a failure reports the host's own
    // words instead of only "expected false to be true".
    const load = await askOverlay(launched.app, 'papers:project:as-you-go-load');
    expect(load.error).toBeUndefined();
    expect(load.ok).toBe(true);
    // The document is the project's, not an error envelope.
    expect(typeof load.state).toBe('string');

    // The action the creator runs with Enter. The fixture declares no shortcut
    // with that id, so the project's OWN handler answers "not found" - which is
    // the point: what must not appear is a gate refusal. Running a real target
    // would launch something on the creator's machine, so this establishes
    // admission without a side effect.
    const launch = await askOverlay(launched.app, 'papers:project:as-you-go-launch', { actionId: 'any-item' });
    expect(launch.ok).toBe(false);
    expect(launch.error).not.toContain('non-host sender');
    expect(launch.error).not.toContain('not available to this kind');
    expect(launch.error).toContain('shortcut was not found');

    // Copying the text of an item.
    const copy = await askOverlay(launched.app, 'papers:project:copy-text', { text: 'an item' });
    expect(copy.ok).toBe(true);

    // AND THE CHANNEL IT MUST NOT HAVE. A launcher is transient: it closes on
    // blur, has no draft and no undo, and state-save-checked rewrites the very
    // document a workspace surface may be editing. Granted read/run/copy only.
    const write = await askOverlay(launched.app, 'papers:project:state-save-checked', {
      state: '{"schemaVersion":1,"groups":[],"shortcuts":[]}',
      revision: 'absent',
    });
    expect(write.ok).toBe(false);
    expect(write.error).toContain('not available to this kind of project surface');
  } finally {
    await launched.close();
  }
}, 180_000);

it('the launcher ignores the active tab even when both projects are open', async () => {
  // Both projects open as tabs, the MUTE one left active - the creator's actual
  // arrangement when they reported this. The answer must not change.
  const { profile } = await twoProjectProfile('papers-launcher-active-tab-');
  const launched = await launchPapers(profile, { fixtures: false, testInvokeChannel: true });
  try {
    const page = await launched.app.firstWindow();
    const enter = (name: string) =>
      page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: name }) })
        .getByRole('button', { name: 'Enter', exact: true });
    await waitFor(async () => await enter('Mute Board').count() === 1, 15000, 'main picker');
    await enter('Mute Board').click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Mute Board' }).count() === 1, 15000, 'mute open');
    await page.locator('.titlebar-left > button').click();
    await enter('Launcher Board').click({ button: 'middle' });
    await waitFor(async () => await page.getByRole('tab').count() === 2, 15000, 'both tabs open');
    // Bring the mute tab back to the front.
    await page.getByRole('tab', { name: 'Mute Board' }).click();
    await page.waitForTimeout(500);
    const result = await press(launched.app);
    expect(result.ok).toBe(true);
    const info = await overlayInfo(launched.app);
    expect(info!.url).toContain(LAUNCHER);
    expect(info!.url).not.toContain(MUTE);
  } finally {
    await launched.close();
  }
}, 180_000);
