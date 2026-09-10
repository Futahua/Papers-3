import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { evalInBackpackProject, launchPapers, waitFor } from './helpers';

const BACKPACK_ID = 'bp-91919191-9191-4191-8191-919191919191';
const UNKNOWN_SOURCE_REF = '92929292-9292-4292-8292-929292929292';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface HostResult {
  ok: boolean;
  sourceRef?: string;
  error?: string;
}

it('executes native open and reveal only for the owning live opaque source grant', async () => {
  expect(process.platform).toBe('win32');

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-native-handoff-e2e-'));
  const projectRoot = path.join(profile, 'backpack-project');
  const dataRoot = path.join(profile, 'PapersData');
  const sourcePath = path.join(profile, 'exact-native-source.txt');

  await fs.mkdir(path.join(projectRoot, 'public'), { recursive: true });
  await fs.mkdir(path.join(dataRoot, 'backpacks', BACKPACK_ID), { recursive: true });

  await fs.writeFile(
    path.join(projectRoot, 'project.json'),
    JSON.stringify({
      schemaVersion: 1,
      backpackId: BACKPACK_ID,
      entry: 'public/index.html',
    }),
    'utf8',
  );

  await fs.writeFile(
    path.join(projectRoot, 'public', 'index.html'),
    `<!doctype html>
<html>
<body>
  <input id="native-source" type="file">
  <script>
    window.__nativeResults = Object.create(null);
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const payload = event.data;
      if (payload && payload.type === 'papers:host:result' && typeof payload.requestId === 'string') {
        window.__nativeResults[payload.requestId] = payload;
      }
    });
  </script>
</body>
</html>`,
    'utf8',
  );

  const backpack = {
    id: BACKPACK_ID,
    name: 'Native Source Acceptance',
    type: 'environment',
    createdAt: '2026-09-11T00:00:00.000Z',
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  };

  await fs.writeFile(
    path.join(dataRoot, 'backpacks', BACKPACK_ID, 'backpack.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...backpack,
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(dataRoot, 'registry.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      backpacks: [backpack],
      lastActiveBackpackId: null,
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(dataRoot, 'backpack-projects.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      projects: {
        [BACKPACK_ID]: {
          root: projectRoot,
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );

  const originalSource = Buffer.from('gate-9.3-exact-native-source', 'utf8');
  await fs.writeFile(sourcePath, originalSource);

  const launched = await launchPapers(profile, { fixtures: false });

  try {
    const page = await launched.app.firstWindow();

    const mainEnter = page
      .locator('.backpack-card')
      .filter({
        has: page.locator('.name', {
          hasText: 'Native Source Acceptance',
        }),
      })
      .getByRole('button', {
        name: 'Enter',
        exact: true,
      });

    await waitFor(
      async () => await mainEnter.count() === 1,
      10_000,
      'seeded Native Source Acceptance Backpack',
    );
    await mainEnter.click();

    await waitFor(
      async () =>
        (await evalInBackpackProject<string>(
          launched.app,
          'document.readyState',
        )) === 'complete',
      10_000,
      'Backpack project did not load',
    );

    await launched.app.evaluate(
      async ({ webContents }, args) => {
        const project = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith(`papers-backpack://${args.backpackId}/`),
          );

        if (!project) {
          throw new Error('Backpack project webContents not found.');
        }

        project.debugger.attach('1.3');
        try {
          const document = await project.debugger.sendCommand(
            'DOM.getDocument',
            { depth: -1, pierce: true },
          ) as { root: { nodeId: number } };

          const input = await project.debugger.sendCommand(
            'DOM.querySelector',
            {
              nodeId: document.root.nodeId,
              selector: '#native-source',
            },
          ) as { nodeId: number };

          if (!input.nodeId) {
            throw new Error('Native source input not found.');
          }

          await project.debugger.sendCommand(
            'DOM.setFileInputFiles',
            {
              nodeId: input.nodeId,
              files: [args.sourcePath],
            },
          );
        } finally {
          project.debugger.detach();
        }
      },
      {
        backpackId: BACKPACK_ID,
        sourcePath,
      },
    );

    await evalInBackpackProject(
      launched.app,
      `(() => {
        window.__nativeResults = Object.create(null);
        window.addEventListener('message', (event) => {
          if (event.source !== window || event.origin !== window.location.origin) return;
          const payload = event.data;
          if (
            payload
            && payload.type === 'papers:host:result'
            && typeof payload.requestId === 'string'
          ) {
            window.__nativeResults[payload.requestId] = payload;
          }
        });
        return true;
      })()`,
    );

    const result = async (requestId: string): Promise<HostResult | null> =>
      evalInBackpackProject<HostResult | null>(
        launched.app,
        `window.__nativeResults?.[${JSON.stringify(requestId)}] ?? null`,
      );

    await evalInBackpackProject(
      launched.app,
      `(() => {
        const input = document.querySelector('#native-source');
        const file = input && input.files && input.files[0];
        if (!file) throw new Error('disk-backed file missing');
        window.postMessage({
          type: 'papers:project:native-source-grant',
          requestId: 'grant',
          files: [file],
        }, window.location.origin);
      })()`,
    );

    await waitFor(
      async () => (await result('grant')) !== null,
      10_000,
      'Native source grant did not settle',
    );

    const granted = await result('grant');
    expect(granted?.ok).toBe(true);
    expect(granted?.sourceRef).toMatch(UUID_V4);
    expect(granted?.sourceRef).not.toContain(sourcePath);

    const sourceRef = granted?.sourceRef;
    if (!sourceRef) {
      throw new Error('Native source grant returned no opaque reference.');
    }

    await evalInBackpackProject(
      launched.app,
      `window.postMessage({
        type: 'papers:project:native-source-open',
        requestId: 'open',
        sourceRef: ${JSON.stringify(sourceRef)},
      }, window.location.origin)`,
    );

    await waitFor(
      async () => (await result('open')) !== null,
      10_000,
      'Native source open did not settle',
    );
    expect((await result('open'))?.ok).toBe(true);

    await evalInBackpackProject(
      launched.app,
      `window.postMessage({
        type: 'papers:project:native-source-reveal',
        requestId: 'reveal',
        sourceRef: ${JSON.stringify(sourceRef)},
      }, window.location.origin)`,
    );

    await waitFor(
      async () => (await result('reveal')) !== null,
      10_000,
      'Native source reveal did not settle',
    );
    expect((await result('reveal'))?.ok).toBe(true);
    expect(await fs.readFile(sourcePath)).toEqual(originalSource);

    await evalInBackpackProject(
      launched.app,
      `window.postMessage({
        type: 'papers:project:native-source-open',
        requestId: 'raw-path',
        sourceRef: ${JSON.stringify(sourcePath)},
      }, window.location.origin)`,
    );

    await waitFor(
      async () => (await result('raw-path')) !== null,
      10_000,
      'Raw-path refusal did not settle',
    );
    expect((await result('raw-path'))?.ok).toBe(false);

    await evalInBackpackProject(
      launched.app,
      `window.postMessage({
        type: 'papers:project:native-source-open',
        requestId: 'unknown',
        sourceRef: ${JSON.stringify(UNKNOWN_SOURCE_REF)},
      }, window.location.origin)`,
    );

    await waitFor(
      async () => (await result('unknown')) !== null,
      10_000,
      'Unknown-grant refusal did not settle',
    );
    expect((await result('unknown'))?.ok).toBe(false);

    await fs.rm(sourcePath);

    await evalInBackpackProject(
      launched.app,
      `window.postMessage({
        type: 'papers:project:native-source-open',
        requestId: 'stale',
        sourceRef: ${JSON.stringify(sourceRef)},
      }, window.location.origin)`,
    );

    await waitFor(
      async () => (await result('stale')) !== null,
      10_000,
      'Stale-grant refusal did not settle',
    );

    const stale = await result('stale');
    expect(stale?.ok).toBe(false);
    expect(stale?.error).toContain('stale');
  } finally {
    await launched.app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
