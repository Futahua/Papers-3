/**
 * THE MERGED TREE: the launcher routes, AND the local-service bridge works.
 *
 * Why this exists rather than trusting the two branches' own tests. The merge
 * joined two independent pieces of host wiring, and the failure mode of a bad
 * merge is not a compile error - it is one feature quietly refusing the other.
 * That is exactly what happened: the routing branch's new capability gate refused
 * `host:backpack-project:local-service-fetch` with "not available to this kind of
 * project surface", because the channel was not in the capability map. The tree
 * built, typechecked and passed every test either branch had.
 *
 * So this drives BOTH features through one real Papers and one real loopback
 * service, and it asserts the distinction the capability work introduced:
 *   - a full project surface (the workspace tab) MAY reach the declared service;
 *   - the LAUNCHER kind may NOT, because a transient overlay that closes on blur
 *     has no business triggering authenticated calls to a service.
 */

import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';

import { evalInBackpackProject, launchPapers, waitFor } from './helpers';

const MUTE = 'bp-11111111-1111-4111-8111-111111111111';
const LAUNCHER = 'bp-22222222-2222-4222-8222-222222222222';

const PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Launcher</title></head>
<body style="margin:0;font:13px system-ui">
  <input id="line" autofocus>
  <script src="./ask.js"></script>
</body></html>`;

const ASK_JS = `
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
    window.postMessage(Object.assign({ type: type, requestId: requestId }, extra || {}), location.origin);
    setTimeout(function () { resolve({ type: 'timeout' }); }, 6000);
  });
};
`;

interface Fixture { profile: string; data: string }

/** Two bound projects; the first declares a local service, neither declares a surface. */
async function profileWithService(origin: string): Promise<Fixture> {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-merged-'));
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
    // The LAUNCHER project declares a command surface; the other declares none.
    if (index === 1) manifest['launcherSurface'] = 'command-surface';
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(root, 'actions.json'), JSON.stringify({ schemaVersion: 1, actions: [] }));
    // Only the MUTE project declares a local service - so the service capability
    // and the launcher capability are cleanly separated by project as well. The
    // declaration itself is written by the caller, once the credential's path
    // inside this project's tree is known.
    await fs.writeFile(
      path.join(root, 'public/index.html'),
      index === 1 ? PAGE : '<h1>Mute Board</h1>',
    );
    if (index === 1) await fs.writeFile(path.join(root, 'public/ask.js'), ASK_JS);
    await fs.writeFile(
      path.join(data, 'backpacks', backpack.id, 'backpack.json'),
      JSON.stringify({ schemaVersion: 1, ...backpack }),
    );
    projects[backpack.id] = { root };
  }
  await fs.writeFile(path.join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }));
  await fs.writeFile(path.join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects }));
  return { profile, data };
}

it('the merged tree launcher routes, and the bridge reaches a real local service', async () => {
  // A real loopback service, so the bridge is doing the whole trip.
  const seen: Array<{ url: string; authorization: string | undefined }> = [];
  const server: Server = createServer((request, response) => {
    seen.push({ url: request.url ?? '', authorization: request.headers['authorization'] });
    if ((request.url ?? '') === '/redirect-away') {
      // A declared, loopback, running service answering with a redirect to
      // ANOTHER loopback origin that the project never declared. If the transport
      // followed this itself, the redirect would be chased and the block below
      // would record a request it must never receive.
      response.writeHead(302, { location: `${awayOrigin}/stolen` });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, board: 'the creator board', headSeq: 165 }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no loopback port');
  const origin = `http://127.0.0.1:${address.port}`;

  // The undeclared second service. It must receive NOTHING.
  const stolen: string[] = [];
  const awayServer: Server = createServer((request, response) => {
    stolen.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('should never be reached');
  });
  await new Promise<void>((resolve) => awayServer.listen(0, '127.0.0.1', resolve));
  const awayAddress = awayServer.address();
  if (awayAddress === null || typeof awayAddress === 'string') throw new Error('no loopback port');
  const awayOrigin = `http://127.0.0.1:${awayAddress.port}`;

  // The credential lives INSIDE the project's own tree, which is the scope the
  // host approves. A declared path outside the approved roots is now refused
  // before anything is read, so a fixture secret in a temp directory would be
  // testing the refusal rather than the bridge.
  const { profile, data } = await profileWithService(origin);
  const secretFile = path.join(profile, MUTE, 'token');
  await fs.writeFile(secretFile, 'the-real-credential\n');
  // The declaration is written now that the path is known.
  await fs.writeFile(path.join(profile, MUTE, 'local-service.json'), JSON.stringify({
    schemaVersion: 1,
    services: [{ origin, secret: 'operator' }],
    secrets: [{ id: 'operator', file: secretFile, header: 'authorization', scheme: 'Bearer' }],
  }));
  void data;
  const launched = await launchPapers(profile, { fixtures: false, testInvokeChannel: true });
  try {
    const page = await launched.app.firstWindow();
    const enter = (name: string) =>
      page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: name }) })
        .getByRole('button', { name: 'Enter', exact: true });

    await waitFor(async () => await enter('Mute Board').count() === 1, 15000, 'main picker');
    await enter('Mute Board').click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Mute Board' }).count() === 1, 15000, 'mute open');

    // --- THE BRIDGE, from a full project surface ------------------------------
    // Evaluated in the PROJECT FRAME, not the host renderer: `firstWindow()`
    // gives the host, and the project protocol is spoken by the project page.
    const fromWorkspace = await evalInBackpackProject(launched.app, `
      (async () => {
        const url = ${JSON.stringify(`${origin}/v1/snapshot`)};
        const requestId = 'bridge-' + Math.random().toString(36).slice(2);
        return await new Promise((resolve) => {
          function onResult(event) {
            if (!event.data || event.data.type !== 'papers:host:result') return;
            if (event.data.requestId !== requestId) return;
            window.removeEventListener('message', onResult);
            resolve(event.data);
          }
          window.addEventListener('message', onResult);
          window.postMessage({ type: 'papers:project:local-service-fetch', requestId, url }, location.origin);
          setTimeout(() => resolve({ type: 'timeout' }), 8000);
        });
      })()
    `) as { ok?: boolean; error?: string; type?: string; localService?: { ok: boolean; status?: number; body?: string } };

    // The capability gate admitted the channel for a real project surface...
    expect(fromWorkspace.error).toBeUndefined();
    // ...and the bridge made the trip.
    expect(fromWorkspace.localService?.ok).toBe(true);
    expect(fromWorkspace.localService?.status).toBe(200);
    expect(fromWorkspace.localService?.body).toContain('the creator board');
    // The service saw exactly one request, carrying the credential the PROJECT
    // declared - never one the page supplied.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.authorization).toBe('Bearer the-real-credential');

    // --- THE REDIRECT, against a REAL Electron transport -----------------------
    // The unit tests prove the bridge's policy; this proves the transport does not
    // defeat it. `net.fetch` follows redirects by default, so if the bridge's
    // `redirect: 'manual'` were ignored the hop below would be CHASED and the
    // undeclared second service would record a request.
    const redirected = await evalInBackpackProject(launched.app, `
      (async () => {
        const url = ${JSON.stringify(`${origin}/redirect-away`)};
        const requestId = 'redir-' + Math.random().toString(36).slice(2);
        return await new Promise((resolve) => {
          function onResult(event) {
            if (!event.data || event.data.type !== 'papers:host:result') return;
            if (event.data.requestId !== requestId) return;
            window.removeEventListener('message', onResult);
            resolve(event.data);
          }
          window.addEventListener('message', onResult);
          window.postMessage({ type: 'papers:project:local-service-fetch', requestId, url }, location.origin);
          setTimeout(() => resolve({ type: 'timeout' }), 8000);
        });
      })()
    `) as { ok?: boolean; error?: string; type?: string; localService?: { ok: boolean; status?: number; detail?: string } };

    expect(redirected.error).toBeUndefined();
    // Refused, as a service the bridge could not complete a request against:
    // MEASURED, Electron's `net.fetch` throws "Redirect was cancelled" instead of
    // handing back the 3xx, so the hop is never chased and its Location is never
    // acted on.
    expect(redirected.localService?.ok).toBe(false);
    expect(redirected.localService?.detail).toContain('could not be reached');
    // THE ASSERTION THAT MATTERS: the transport did NOT follow it. The undeclared
    // loopback service received nothing at all - which is the property the
    // initial-URL-only check could not give: this machine never goes where the
    // project did not declare.
    expect(stolen).toEqual([]);

    // --- THE LAUNCHER, which must NOT reach a service --------------------------
    await page.locator('.titlebar-left > button').click();
    await waitFor(async () => await enter('Launcher Board').count() === 1, 15000, 'picker again');
    await enter('Launcher Board').click({ button: 'middle' });
    await waitFor(async () => await page.getByRole('tab').count() === 2, 15000, 'both tabs');
    await page.getByRole('tab', { name: 'Mute Board' }).click();
    await page.waitForTimeout(400);
    await launched.app.evaluate(async ({ BaseWindow }) => {
      for (const win of BaseWindow.getAllWindows()) {
        try { win.show(); win.focus(); } catch { /* not focusable */ }
      }
    });

    const opened = await launched.app.evaluate(async () => {
      const seam = (globalThis as unknown as Record<string, unknown>)['__papersTestOpenCommandSurface'];
      if (typeof seam !== 'function') throw new Error('the launcher test seam is absent');
      return (await (seam as () => Promise<{ ok: boolean; detail: string }>)());
    }) as { ok: boolean; detail: string };
    // The routing half of the merged tree: the launcher targets the DECLARING
    // project, and the declaring project is NOT the one in front.
    expect(opened.ok).toBe(true);

    const overlayUrl = await launched.app.evaluate(async ({ BaseWindow }) => {
      for (const win of BaseWindow.getAllWindows()) {
        const own = (win as unknown as { webContents?: Electron.WebContents }).webContents;
        if (!own || own.isDestroyed()) continue;
        if (own.getURL().includes('papers-surface=command-surface')) return own.getURL();
      }
      return '';
    });
    expect(overlayUrl).toContain(LAUNCHER);
    expect(overlayUrl).not.toContain(MUTE);

    // And the launcher may not reach a service, even though it is a project
    // surface and even though a project on this machine declares one.
    const beforeLauncherAttempt = seen.length;
    const fromLauncher = await launched.app.evaluate(async ({ BaseWindow }, url) => {
      for (const win of BaseWindow.getAllWindows()) {
        const own = (win as unknown as { webContents?: Electron.WebContents }).webContents;
        if (!own || own.isDestroyed()) continue;
        if (!own.getURL().includes('papers-surface=command-surface')) continue;
        return await own.executeJavaScript(
          `window.__ask('papers:project:local-service-fetch', { url: ${JSON.stringify(url)} })`,
          true,
        );
      }
      throw new Error('the launcher surface is not open');
    }, `${origin}/v1/snapshot`) as { ok?: boolean; error?: string; type?: string };

    // Refused, by name, as a capability this kind of surface does not have.
    expect(fromLauncher.ok).toBe(false);
    expect(fromLauncher.error).toContain('not available to this kind of project surface');
    // AND NOTHING WAS SENT: a refusal must not be a request that happened anyway.
    expect(seen.length).toBe(beforeLauncherAttempt);
  } finally {
    await launched.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => awayServer.close(() => resolve()));
  }
}, 180_000);
