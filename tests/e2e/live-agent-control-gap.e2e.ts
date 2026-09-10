import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, it } from 'vitest';
import { papersControlCommands } from '../../src/main/control/papersControlProtocol';
import { launchPapers, waitFor } from './helpers';

const PROJECT = 'bp-10101010-1010-4010-8010-101010101010';
const SEMANTIC_KEY = 'gate10.c1.root';

async function call<T>(
  client: Client,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await client.callTool({
    name: 'papers_control',
    arguments: { method, params },
  });

  expect(response.isError).not.toBe(true);

  const content = response.content as Array<{
    type: string;
    text?: string;
  }>;

  expect(content).toHaveLength(1);
  expect(content[0]).toEqual(expect.objectContaining({
    type: 'text',
    text: expect.any(String),
  }));

  return JSON.parse(content[0]!.text!) as T;
}

async function refused(
  client: Client,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  const response = await client.callTool({
    name: 'papers_control',
    arguments: { method, params },
  });

  expect(response.isError).toBe(true);

  const content = response.content as Array<{
    type: string;
    text?: string;
  }>;

  expect(content).toHaveLength(1);
  expect(content[0]).toEqual(expect.objectContaining({
    type: 'text',
    text: expect.any(String),
  }));
}

it('proves the Gate 10.1 live-agent-control gap without renderer evaluation', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'papers3-gate10-gap-'));
  const descriptorPath = join(userDataDir, 'dev-control.json');
  const dataDir = join(userDataDir, 'PapersData');
  const backpackDir = join(dataDir, 'backpacks', PROJECT);
  const projectRoot = join(dataDir, 'gate10-live-gap-project');

  const backpack = {
    id: PROJECT,
    name: 'Gate 10.1 live control target',
    type: 'environment',
    createdAt: '2026-09-11T00:00:00.000Z',
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  };

  await mkdir(backpackDir, { recursive: true });
  await mkdir(join(projectRoot, 'public'), { recursive: true });

  await writeFile(
    join(dataDir, 'registry.json'),
    JSON.stringify({
      schemaVersion: 1,
      backpacks: [backpack],
      lastActiveBackpackId: null,
    }),
  );

  await writeFile(
    join(backpackDir, 'backpack.json'),
    JSON.stringify({
      schemaVersion: 1,
      ...backpack,
    }),
  );

  await writeFile(
    join(dataDir, 'backpack-projects.json'),
    JSON.stringify({
      schemaVersion: 1,
      projects: {
        [PROJECT]: {
          root: projectRoot,
        },
      },
    }),
  );

  await writeFile(
    join(projectRoot, 'project.json'),
    JSON.stringify({
      schemaVersion: 1,
      backpackId: PROJECT,
      entry: 'public/index.html',
    }),
  );

  await writeFile(
    join(projectRoot, 'public', 'index.html'),
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #f5f2ea;
      color: #211f1b;
    }

    main {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 48px;
    }
  </style>
</head>
<body>
  <main data-papers-visual-key="${SEMANTIC_KEY}">
    <h1>Gate 10.1 live control target</h1>
  </main>
</body>
</html>`,
    'utf8',
  );

  const launched = await launchPapers(userDataDir, {
    fixtures: false,
    devControlDescriptor: descriptorPath,
  });

  let client: Client | null = null;

  try {
    await waitFor(
      async () => {
        try {
          await readFile(descriptorPath, 'utf8');
          return true;
        } catch {
          return false;
        }
      },
      10_000,
      'Gate 10.1 control descriptor',
    );

    const mcpToolPath = fileURLToPath(
      new URL('../../tools/papersMcp.mjs', import.meta.url),
    );
    const mcpWorkingDirectory = fileURLToPath(
      new URL('../..', import.meta.url),
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        mcpToolPath,
        '--descriptor',
        descriptorPath,
      ],
      cwd: mcpWorkingDirectory,
      stderr: 'pipe',
    });

    let mcpStderr = '';
    transport.stderr?.on('data', (chunk) => {
      mcpStderr += String(chunk);
    });

    client = new Client({
      name: 'papers-gate10-gap-e2e',
      version: '1.0.0',
    });

    try {
      await client.connect(transport);
    } catch (error) {
      throw new Error(
        [
          'Gate 10.1 real stdio MCP child failed during startup.',
          `node=${process.execPath}`,
          `tool=${mcpToolPath}`,
          `cwd=${mcpWorkingDirectory}`,
          `descriptor=${descriptorPath}`,
          `stderr=${mcpStderr.trim() || '<empty>'}`,
          `transport=${String(error)}`,
        ].join('\n'),
      );
    }

    const methods = Object.keys(papersControlCommands);

    expect(methods.filter((method) => method.includes('proxima'))).toEqual([]);
    expect(methods).not.toContain('proxima.action');
    expect(methods).not.toContain('proxima.inspect');
    expect(methods).not.toContain('project.action');
    expect(methods).not.toContain('project.inspect');
    expect(methods).not.toContain('renderer.evaluate');
    expect(
      methods.some((method) => /(?:eval|javascript|script)/i.test(method)),
    ).toBe(false);

    const windows = await call<Array<{
      windowId: number;
      hostAlive: boolean;
      nativeWindowAlive: boolean;
    }>>(client, 'inspect.windows');

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      windowId: expect.any(Number),
      hostAlive: true,
      nativeWindowAlive: true,
    });

    const windowId = windows[0]!.windowId;

    // Established Papers control E2Es first let the ordinary host entry path
    // establish the workspace/native-surface lifecycle, retire that initial
    // surface through control, and only then exercise canonical workspace.open.
    // The Gate 10.1 target below is still created exclusively by papers_control.
    const hostPage = await launched.app.firstWindow();
    const seededEnter = hostPage
      .locator('.backpack-card')
      .filter({
        has: hostPage.locator('.name', {
          hasText: 'Gate 10.1 live control target',
        }),
      })
      .getByRole('button', {
        name: 'Enter',
        exact: true,
      });

    await waitFor(
      async () => await seededEnter.isVisible(),
      10_000,
      'Gate 10.1 seeded Backpack entry',
    );
    await seededEnter.click();

    await waitFor(
      async () => {
        const surfaces = await call<Array<{
          windowId: number;
          surfaceId: string;
          projectId: string;
          kind: string;
          presentation: string;
        }>>(client!, 'inspect.surfaces');

        return surfaces.some((surface) =>
          surface.windowId === windowId
          && surface.projectId === PROJECT
          && surface.kind === 'project'
          && surface.presentation === 'visible'
        );
      },
      10_000,
      'Gate 10.1 initial host-created project surface',
    );

    const initialSurfaces = await call<Array<{
      windowId: number;
      surfaceId: string;
      projectId: string;
      kind: string;
      presentation: string;
    }>>(client, 'inspect.surfaces');

    const initialSurface = initialSurfaces.find((surface) =>
      surface.windowId === windowId
      && surface.projectId === PROJECT
      && surface.kind === 'project'
      && surface.presentation === 'visible'
    );

    expect(initialSurface).toEqual(expect.objectContaining({
      windowId,
      surfaceId: expect.any(String),
      projectId: PROJECT,
      kind: 'project',
      presentation: 'visible',
    }));

    // inspect.surfaces already proved the ordinary host bootstrap exactly.
    // Retire it now and reproduce the established same-project control
    // lifecycle: the presentation pair used below must consist only of
    // canonical workspace.open runtimes.
    expect(initialSurface).toEqual({
      windowId,
      surfaceId: initialSurface!.surfaceId,
      projectId: PROJECT,
      kind: 'project',
      presentation: 'visible',
    });

    await call(client, 'workspace.close', {
      windowId,
      surfaceId: initialSurface!.surfaceId,
    });

    await waitFor(
      async () => {
        const surfaces = await call<Array<{
          windowId: number;
          surfaceId: string;
          projectId: string;
        }>>(client!, 'inspect.surfaces');

        return !surfaces.some((surface) =>
          surface.windowId === windowId
          && surface.surfaceId === initialSurface!.surfaceId
        );
      },
      10_000,
      'Gate 10.1 bootstrap surface retirement',
    );

    const opened = await call<{
      windowId: number;
      surfaceId: string;
      projectId: string;
    }>(client, 'workspace.open', {
      windowId,
      projectId: PROJECT,
    });

    expect(opened).toMatchObject({
      windowId,
      surfaceId: expect.any(String),
      projectId: PROJECT,
    });

    // Existing same-project control coverage requires two independently
    // prepared workspace.open runtimes before layout.split establishes native
    // presentation for both. This companion is lifecycle scaffolding only; the
    // Gate 10.1 target remains the first exact workspace.open result.
    const companion = await call<{
      windowId: number;
      surfaceId: string;
      projectId: string;
    }>(client, 'workspace.open', {
      windowId,
      projectId: PROJECT,
    });

    expect(companion).toMatchObject({
      windowId,
      surfaceId: expect.any(String),
      projectId: PROJECT,
    });
    expect(companion.surfaceId).not.toBe(opened.surfaceId);

    await waitFor(
      async () => {
        const surfaces = await call<Array<{
          windowId: number;
          surfaceId: string;
          projectId: string;
        }>>(client!, 'inspect.surfaces');

        return surfaces.length === 2
          && surfaces.some((surface) =>
            surface.windowId === windowId
            && surface.surfaceId === opened.surfaceId
            && surface.projectId === PROJECT
          )
          && surfaces.some((surface) =>
            surface.windowId === windowId
            && surface.surfaceId === companion.surfaceId
            && surface.projectId === PROJECT
          );
      },
      10_000,
      'Gate 10.1 two canonical workspace.open runtimes',
    );

    // Match the established same-project control lifecycle exactly: logical
    // surfaces are not native-ready until both independently loaded project
    // WebContents exist. Observe that main-process truth before any topology,
    // activation, layout.split, or native-presentation assertion.
    await waitFor(
      async () =>
        await launched.app.evaluate(
          ({ webContents }, projectId) =>
            webContents
              .getAllWebContents()
              .filter((contents) =>
                contents.getURL().startsWith(`papers-backpack://${projectId}/`)
              )
              .length,
          PROJECT,
        ) === 2,
      10_000,
      'Gate 10.1 two same-project native renderers',
    );

    const nativeRendererCount = await launched.app.evaluate(
      ({ webContents }, projectId) =>
        webContents
          .getAllWebContents()
          .filter((contents) =>
            contents.getURL().startsWith(`papers-backpack://${projectId}/`)
          )
          .length,
      PROJECT,
    );

    expect(nativeRendererCount).toBe(2);

    const target = {
      windowId,
      surfaceId: opened.surfaceId,
    };

    // Native WebContents existence proves both canonical runtimes were created,
    // but workspace.open delivers host metadata separately. The established
    // programmatic-open E2E does not continue until the corresponding Dockview
    // tab exists. With two same-project surfaces, require both host tabs before
    // layout.split so the host has consumed both workspace-project-opened events.
    // This is observation only: no activation, click, DOM mutation or renderer
    // evaluation occurs before the established presentation transition.
    await waitFor(
      async () => {
        const workspace = await call<{
          topology: {
            groups: Array<{
              groupId: string;
              surfaceIds: string[];
              activeSurfaceId: string | null;
            }>;
          };
        }>(client!, 'inspect.workspace', { windowId });

        const canonicalGroup = workspace.topology.groups.find((group) =>
          group.surfaceIds.includes(opened.surfaceId)
          && group.surfaceIds.includes(companion.surfaceId)
        );

        return workspace.topology.groups.length === 1
          && Boolean(canonicalGroup)
          && canonicalGroup!.surfaceIds.length === 2
          && canonicalGroup!.surfaceIds.includes(opened.surfaceId)
          && canonicalGroup!.surfaceIds.includes(companion.surfaceId)
          && await hostPage.getByRole('tab', {
            name: 'Gate 10.1 live control target',
            exact: true,
          }).count() === 2;
      },
      10_000,
      'Gate 10.1 two canonical workspace.open host tabs',
    );

    const preSplitSurfaces = await call<Array<{
      windowId: number;
      surfaceId: string;
      projectId: string;
      kind: string;
      presentation: string;
    }>>(client, 'inspect.surfaces');

    expect(preSplitSurfaces).toHaveLength(2);
    expect(preSplitSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId,
        surfaceId: opened.surfaceId,
        projectId: PROJECT,
        kind: 'project',
        presentation: expect.stringMatching(/^(hidden|visible)$/),
      }),
      expect.objectContaining({
        windowId,
        surfaceId: companion.surfaceId,
        projectId: PROJECT,
        kind: 'project',
        presentation: expect.stringMatching(/^(hidden|visible)$/),
      }),
    ]));

    // A one-group/two-tab Papers workspace has one active native presentation.
    // The second canonical workspace.open is active, so wait for the established
    // host/native contract to settle before splitting: the first exact runtime
    // is hidden and the second exact runtime is visible. This uses the real
    // papers_control projection of runtime.isPresented; no renderer evaluation
    // or invented lifecycle diagnostic is involved.
    await waitFor(
      async () => {
        const surfaces = await call<Array<{
          windowId: number;
          surfaceId: string;
          projectId: string;
          kind: string;
          presentation: string;
        }>>(client!, 'inspect.surfaces');

        const openedSurface = surfaces.find(
          (surface) => surface.surfaceId === opened.surfaceId,
        );
        const companionSurface = surfaces.find(
          (surface) => surface.surfaceId === companion.surfaceId,
        );

        return surfaces.length === 2
          && openedSurface?.windowId === windowId
          && openedSurface.projectId === PROJECT
          && openedSurface.kind === 'project'
          && openedSurface.presentation === 'hidden'
          && companionSurface?.windowId === windowId
          && companionSurface.projectId === PROJECT
          && companionSurface.kind === 'project'
          && companionSurface.presentation === 'visible';
      },
      10_000,
      'Gate 10.1 settled canonical two-tab native presentation',
    );

    const settledPreSplitSurfaces = await call<Array<{
      windowId: number;
      surfaceId: string;
      projectId: string;
      kind: string;
      presentation: string;
    }>>(client, 'inspect.surfaces');

    expect(settledPreSplitSurfaces).toEqual(expect.arrayContaining([
      {
        windowId,
        surfaceId: opened.surfaceId,
        projectId: PROJECT,
        kind: 'project',
        presentation: 'hidden',
      },
      {
        windowId,
        surfaceId: companion.surfaceId,
        projectId: PROJECT,
        kind: 'project',
        presentation: 'visible',
      },
    ]));

    // Both exact canonical surfaces have now reached the established
    // one-group presentation state. Split the exact first workspace.open
    // surface and retain the strict both-visible/native-target proofs below.
    const split = await call<{
      windowId: number;
      topology: {
        groups: Array<{
          groupId: string;
          surfaceIds: string[];
          activeSurfaceId: string | null;
        }>;
      };
    }>(client, 'layout.split', {
      ...target,
      direction: 'right',
    });

    expect(split.windowId).toBe(windowId);
    expect(
      split.topology.groups.some((group) =>
        group.surfaceIds.includes(opened.surfaceId)
      ),
    ).toBe(true);

    // Capture the real papers_control projection immediately after split before
    // waiting for renderer presentation convergence. This preserves the exact
    // identities and makes any lifecycle mismatch visible in Vitest output
    // without treating immediate native visibility as synchronous.
    const immediatePostSplitSurfaces = await call<Array<{
      windowId: number;
      surfaceId: string;
      projectId: string;
      kind: string;
      presentation: string;
    }>>(client, 'inspect.surfaces');

    expect(immediatePostSplitSurfaces).toHaveLength(2);
    expect(immediatePostSplitSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId,
        surfaceId: opened.surfaceId,
        projectId: PROJECT,
        kind: 'project',
        presentation: expect.stringMatching(/^(hidden|visible)$/),
      }),
      expect.objectContaining({
        windowId,
        surfaceId: companion.surfaceId,
        projectId: PROJECT,
        kind: 'project',
        presentation: expect.stringMatching(/^(hidden|visible)$/),
      }),
    ]));

    // layout.split commits main-owned topology before the host renderer has
    // necessarily reconciled Dockview. Existing semantic-split coverage fences
    // on two real Dockview groups before asserting native presentation.
    await waitFor(
      async () => await hostPage.locator('.dv-groupview').count() === 2,
      10_000,
      'Gate 10.1 semantic split host convergence',
    );

    // Resolve the remaining host/native fork using ordinary Playwright DOM
    // inspection only. Papers itself stamps each Dockview tab with the exact
    // canonical surface id in data-tab-panel-id, while aria-selected is the
    // established active-tab signal. If this assertion fails, Dockview did not
    // reconcile both canonical active surfaces into separate visible groups.
    // If it passes and the unchanged native-presentation wait below still
    // fails, the defect is downstream in WorkspacePanel/BackpackProjectFrame
    // visibility intent rather than recursive Dockview topology reconciliation.
    const postSplitGroups = hostPage.locator('.dv-groupview');
    const openedTabSelector =
      `.dv-tab[data-tab-panel-id="${opened.surfaceId}"]`;
    const companionTabSelector =
      `.dv-tab[data-tab-panel-id="${companion.surfaceId}"]`;
    const diagnosticOpenedTab = hostPage.locator(openedTabSelector);
    const companionTab = hostPage.locator(companionTabSelector);

    const groupIndexesFor = async (selector: string): Promise<number[]> => {
      const indexes: number[] = [];
      const groupCount = await postSplitGroups.count();
      for (let index = 0; index < groupCount; index += 1) {
        if (await postSplitGroups.nth(index).locator(selector).count() === 1) {
          indexes.push(index);
        }
      }
      return indexes;
    };

    const [
      groupCount,
      openedTabCount,
      companionTabCount,
      openedGroupIndexes,
      companionGroupIndexes,
    ] = await Promise.all([
      postSplitGroups.count(),
      diagnosticOpenedTab.count(),
      companionTab.count(),
      groupIndexesFor(openedTabSelector),
      groupIndexesFor(companionTabSelector),
    ]);

    const postSplitDomDiagnostic = {
      groupCount,
      openedTabCount,
      companionTabCount,
      openedSelected:
        openedTabCount === 1
          ? await diagnosticOpenedTab.getAttribute('aria-selected')
          : null,
      companionSelected:
        companionTabCount === 1
          ? await companionTab.getAttribute('aria-selected')
          : null,
      openedGroupIndexes,
      companionGroupIndexes,
      separateGroups:
        openedGroupIndexes.length === 1
        && companionGroupIndexes.length === 1
        && openedGroupIndexes[0] !== companionGroupIndexes[0],
    };

    expect(postSplitDomDiagnostic).toEqual({
      groupCount: 2,
      openedTabCount: 1,
      companionTabCount: 1,
      openedSelected: 'true',
      companionSelected: 'true',
      openedGroupIndexes: [expect.any(Number)],
      companionGroupIndexes: [expect.any(Number)],
      separateGroups: true,
    });

    await waitFor(
      async () => {
        const surfaces = await call<Array<{
          windowId: number;
          surfaceId: string;
          projectId: string;
          presentation: string;
        }>>(client!, 'inspect.surfaces');

        return surfaces.length === 2
          && surfaces.some((surface) =>
            surface.windowId === windowId
            && surface.surfaceId === opened.surfaceId
            && surface.projectId === PROJECT
            && surface.presentation === 'visible'
          )
          && surfaces.some((surface) =>
            surface.windowId === windowId
            && surface.surfaceId === companion.surfaceId
            && surface.projectId === PROJECT
            && surface.presentation === 'visible'
          );
      },
      10_000,
      'Gate 10.1 both canonical native presentations visible',
    );

    // The DOM fork and strict two-surface presentation proof above have already
    // converged. Do not hide the exact singular papers_control result behind a
    // polling catch: the direct inspect.surface equality below must either prove
    // the same exact target visible or expose the real control/state failure.

    const surface = await call<{
      windowId: number;
      surfaceId: string;
      projectId: string;
      kind: string;
      presentation: string;
    }>(client, 'inspect.surface', target);

    expect(surface).toEqual({
      windowId,
      surfaceId: opened.surfaceId,
      projectId: PROJECT,
      kind: 'project',
      presentation: 'visible',
    });

    // Retain exact topology/activation/tab evidence only after native
    // presentation has passed its strict exact-target proof. Existing accepted
    // same-project coverage establishes workspace.activate after split without
    // collapsing either native presentation.
    const visibleWorkspace = await call<{
      topology: {
        focusedGroupId: string;
        groups: Array<{
          groupId: string;
          surfaceIds: string[];
          activeSurfaceId: string | null;
        }>;
      };
    }>(client, 'inspect.workspace', { windowId });

    expect(visibleWorkspace.topology.groups).toHaveLength(2);

    const openedGroupIndex = visibleWorkspace.topology.groups.findIndex(
      (group) => group.surfaceIds.includes(opened.surfaceId),
    );
    expect(openedGroupIndex).toBeGreaterThanOrEqual(0);

    const openedGroup = visibleWorkspace.topology.groups[openedGroupIndex]!;
    expect(openedGroup.surfaceIds).toEqual([opened.surfaceId]);

    const activated = await call<{
      windowId: number;
      topology: {
        focusedGroupId: string;
        groups: Array<{
          groupId: string;
          surfaceIds: string[];
          activeSurfaceId: string | null;
        }>;
      };
    }>(client, 'workspace.activate', target);

    expect(activated.windowId).toBe(windowId);

    const activatedGroupIndex = activated.topology.groups.findIndex(
      (group) => group.groupId === activated.topology.focusedGroupId,
    );
    expect(activatedGroupIndex).toBeGreaterThanOrEqual(0);

    const activatedGroup = activated.topology.groups[activatedGroupIndex]!;
    expect(activatedGroup.surfaceIds).toEqual([opened.surfaceId]);
    expect(activatedGroup.activeSurfaceId).toBe(opened.surfaceId);

    const openedTab = hostPage
      .locator('.dv-groupview')
      .nth(activatedGroupIndex)
      .getByRole('tab', {
        name: 'Gate 10.1 live control target',
        exact: true,
      });

    await waitFor(
      async () =>
        await openedTab.count() === 1
        && await openedTab.getAttribute('aria-selected') === 'true',
      10_000,
      'Gate 10.1 exact returned split-surface tab',
    );

    const settled = await call<{
      windowId: number;
      surfaceId: string;
      status: string;
    }>(client, 'visual.wait', {
      ...target,
      until: 'layout-stable',
      timeoutMs: 5_000,
    });

    expect(settled).toEqual({
      windowId,
      surfaceId: opened.surfaceId,
      status: 'layout-stable',
    });

    const inspected = await call<{
      windowId: number;
      surfaceId: string;
      elements: Array<{
        key: string;
        role?: string;
        visible?: boolean;
      }>;
    }>(client, 'inspect.visual.elements', {
      ...target,
      keys: [SEMANTIC_KEY],
    });

    expect(inspected.windowId).toBe(windowId);
    expect(inspected.surfaceId).toBe(opened.surfaceId);
    expect(inspected.elements).toEqual([
      expect.objectContaining({
        key: SEMANTIC_KEY,
        role: 'main',
        visible: true,
      }),
    ]);

    const captured = await call<{
      target: {
        windowId: number;
        surfaceId: string;
        projectId: string;
      };
      consistency: {
        status: string;
      };
      presentation: string;
      summary: {
        semanticKeys: string[];
      };
      png?: {
        mimeType: string;
        size: number;
        sha256: string;
      };
    }>(client, 'capture.surface', target);

    expect(captured.target).toEqual({
      windowId,
      surfaceId: opened.surfaceId,
      projectId: PROJECT,
    });
    expect(captured.consistency).toEqual({
      status: 'stable',
    });
    expect(captured.presentation).toBe('visible');
    expect(captured.summary.semanticKeys).toContain(SEMANTIC_KEY);
    expect(captured.png).toMatchObject({
      mimeType: 'image/png',
      size: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(captured.png!.size).toBeGreaterThan(0);

    await refused(client, 'proxima.action', {
      ...target,
      action: {
        type: 'project.select',
        projectId: PROJECT,
      },
    });

    await refused(client, 'project.action', {
      ...target,
      action: {
        type: 'project.select',
        projectId: PROJECT,
      },
    });

    await refused(client, 'proxima.inspect', target);
    await refused(client, 'project.inspect', target);

    await refused(client, 'workspace.open', {
      windowId,
      projectId: PROJECT,
      action: {
        type: 'project.select',
        projectId: PROJECT,
      },
    });

    await refused(client, 'inspect.surface', {
      ...target,
      projection: 'proxima-owned-state',
    });

    await refused(client, 'renderer.evaluate', {
      ...target,
      script: 'document.body.dataset.gate10 = "mutated"',
    });

    await refused(client, 'inspect.visual.elements', {
      ...target,
      keys: [SEMANTIC_KEY],
      script: 'document.body.textContent',
    });
  } finally {
    await client?.close().catch(() => undefined);
    await launched.close();
    await rm(userDataDir, {
      recursive: true,
      force: true,
    });
  }
});
