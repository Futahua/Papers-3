import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInBackpackProject, evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const PROJECT = 'bp-11111111-1111-4111-8111-111111111111';
let launched: LaunchedApp;
let descriptorPath: string;

async function call(method: string, params: unknown = {}): Promise<unknown> {
  const connection = await connectPapersControl(await readDescriptor(descriptorPath));
  try {
    const response = await connection.call(method, params) as { ok: boolean; result?: unknown; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'control request failed');
    return response.result;
  } finally {
    connection.close();
  }
}

async function evalInProjectWindow<T>(windowId: number, script: string): Promise<T> {
  return launched.app.evaluate(async ({ BaseWindow }, args) => {
    const window = BaseWindow.getAllWindows().find((candidate) => candidate.id === args.windowId);
    if (!window) throw new Error(`no window with id ${args.windowId}`);
    const project = (window.contentView.children as Electron.WebContentsView[])
      .find((view) => view.webContents.getURL().startsWith('papers-backpack://'));
    if (!project) throw new Error('no project view');
    return project.webContents.executeJavaScript(args.script, true);
  }, { windowId, script }) as Promise<T>;
}

beforeAll(async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'papers3-project-visual-'));
  descriptorPath = join(userDataDir, 'dev-control.json');
  const dataDir = join(userDataDir, 'PapersData');
  const projectRoot = join(dataDir, 'neutral-project');
  const backpackDir = join(dataDir, 'backpacks', PROJECT);
  const backpack = {
    id: PROJECT, name: 'Neutral project', type: 'environment',
    createdAt: '2026-09-02T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null,
  };
  await mkdir(join(projectRoot, 'public'), { recursive: true });
  await mkdir(backpackDir, { recursive: true });
  await writeFile(join(dataDir, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
  await writeFile(join(backpackDir, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
  await writeFile(join(dataDir, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [PROJECT]: { root: projectRoot } } }));
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: PROJECT, entry: 'public/index.html' }));
  await writeFile(join(projectRoot, 'public', 'index.html'), '<!doctype html><script src="app.js"></script><h1>Neutral project</h1>');
  await writeFile(join(projectRoot, 'public', 'app.js'), `window.__papersProjectVisualDiagnosticTestV1 = () => {
      setTimeout(() => { throw new Error('C:\\\\private\\\\project-late.js token=secret'); }, 0);
      setTimeout(() => { Promise.reject(new Error('C:\\\\private\\\\project-late-promise.js password=secret')); }, 0);
    };
    Promise.reject(new Error('C:\\\\private\\\\project-promise.js password=secret'));
    throw new Error('C:\\\\private\\\\project.js token=secret');`);
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try { await readFile(descriptorPath, 'utf8'); return true; } catch { return false; }
  }, 10_000, 'project visual control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
});

describe('project renderer visual diagnostics', () => {
  it('captures main-world failures through the exact window and surface target', async () => {
    const windowId = await launched.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.id);
    const before = await call('inspect.visual.diagnostics', { windowId }) as Array<{ sequence: number }>;
    const beforeSequence = Math.max(0, ...before.map((record) => record.sequence));
    const opened = await evalInHost<{ url: string; surfaceId: string }>(
      launched.app,
      `window.papersHost.backpackProject.open(${JSON.stringify(PROJECT)})`,
    );
    await evalInHost(
      launched.app,
      `window.papersHost.backpackProject.showSurface(${JSON.stringify(opened.surfaceId)}, ${JSON.stringify(opened.url)}).then(() => true)`,
    );
    await evalInHost(launched.app, `window.papersHost.layout.commitWorkspaceTopology(${JSON.stringify({
        schemaVersion: 1,
        surfaces: [{ surfaceId: opened.surfaceId, projectId: PROJECT, title: 'Neutral project' }],
        groups: [{ groupId: 'group-main', surfaceIds: [opened.surfaceId], activeSurfaceId: opened.surfaceId }],
        root: { kind: 'group', groupId: 'group-main' },
        focusedGroupId: 'group-main',
      })}).then(() => true)`);
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ surfaceId: string; presentation: string }>)
      .some((surface) => surface.surfaceId === opened.surfaceId && surface.presentation === 'visible'),
    10_000, 'initial project presentation');
    expect(await evalInBackpackProject(launched.app, 'Boolean(window.__papersVisualDiagnosticObserverV1)')).toBe(true);
    expect(await evalInBackpackProject(launched.app,
      `typeof window.papersVisualDiagnosticBridgeV1?.reportFirstPaint`)).toBe('undefined');
    await evalInBackpackProject(launched.app,
      `window.papersVisualDiagnosticBridgeV1.reportStateHydrated('neutral-rev-1', { cards: 1, groups: 1 }); true`);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
        sequence: number; payload: { kind?: string; phase?: string };
      }>;
      return records.some((record) => record.sequence > beforeSequence
        && record.payload.kind === 'lifecycle' && record.payload.phase === 'first-paint');
    }, 10_000, 'project PerformancePaintTiming first-paint signal');
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
        sequence: number; payload: { kind?: string; phase?: string; detail?: string };
      }>;
      return records.some((record) => record.sequence > beforeSequence
        && record.payload.kind === 'lifecycle' && record.payload.phase === 'layout-stable'
        && record.payload.detail === undefined);
    }, 10_000, 'project event-driven layout-stable signal');
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
        sequence: number; payload: { kind?: string; phase?: string; revision?: string; summary?: Record<string, number> };
      }>;
      return records.some((record) => record.sequence > beforeSequence
        && record.payload.kind === 'lifecycle' && record.payload.phase === 'state-hydrated'
        && record.payload.revision === 'neutral-rev-1');
    }, 10_000, 'project hydration success signal');
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{ sequence: number; payload: { kind?: string } }>;
      return records.filter((record) => record.sequence > beforeSequence
        && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection')).length >= 2;
    }, 10_000, 'project renderer failure diagnostics');
    const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{ sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string } }>;
    const failures = records.filter((record) => record.sequence > beforeSequence
      && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection'));
    expect(failures).toHaveLength(2);
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: { windowId, surfaceId: opened.surfaceId }, payload: { kind: 'uncaught-error', message: 'Uncaught Error: <path> token=<redacted>' } }),
      expect.objectContaining({ target: { windowId, surfaceId: opened.surfaceId }, payload: { kind: 'unhandled-rejection', message: '<path> password=<redacted>' } }),
    ]));

    // Cross-window preparation loads a new renderer before the logical surface
    // moves. Its bootstrap failures must be refused because that sender is not
    // yet canonical; after adoption, the replacement sender must be accepted.
    const second = await call('workspace.open', { windowId, projectId: PROJECT }) as { surfaceId: string };
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ surfaceId: string }>).length === 2,
      10_000, 'second project surface');
    const secondary = await call('window.create') as { windowId: number };
    await waitFor(async () => (await call('inspect.windows') as Array<{ windowId: number }>)
      .some((candidate) => candidate.windowId === secondary.windowId), 10_000, 'project diagnostic move target');
    const beforeTarget = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{ sequence: number }>;
    const beforeTargetSequence = Math.max(0, ...beforeTarget.map((record) => record.sequence));
    await call('layout.moveSurfaceToWindow', {
      sourceWindowId: windowId,
      surfaceId: second.surfaceId,
      targetWindowId: secondary.windowId,
      targetGroupId: 'group-main',
      targetIndex: 0,
    });
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; windowId: number; presentation: string }>;
      return surfaces.some((surface) => surface.surfaceId === second.surfaceId
        && surface.windowId === secondary.windowId && surface.presentation === 'visible');
    }, 15_000, 'project diagnostic move adoption');
    const stagedFailures = (await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
      sequence: number; target: { surfaceId?: string }; payload: { kind?: string };
    }>).filter((record) => record.sequence > beforeTargetSequence
      && record.target.surfaceId === second.surfaceId
      && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection'));
    expect(stagedFailures).toHaveLength(0);
    await evalInProjectWindow<boolean>(secondary.windowId, 'window.__papersProjectVisualDiagnosticTestV1(); true');
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { surfaceId?: string }; payload: { kind?: string };
      }>;
      return records.filter((record) => record.sequence > beforeTargetSequence
        && record.target.surfaceId === second.surfaceId
        && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection')).length >= 2;
    }, 10_000, 'current replacement project diagnostics');
    await evalInProjectWindow<boolean>(secondary.windowId,
      `window.papersVisualDiagnosticBridgeV1.reportHydrationFailed('neutral-rev-1', 'parse', 'fixture-failure'); true`);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { surfaceId?: string }; payload: { kind?: string; revision?: string; stage?: string; code?: string };
      }>;
      return records.some((record) => record.sequence > beforeTargetSequence
        && record.target.surfaceId === second.surfaceId
        && record.payload.kind === 'hydration-failed'
        && record.payload.revision === 'neutral-rev-1'
        && record.payload.stage === 'parse' && record.payload.code === 'fixture-failure');
    }, 10_000, 'current replacement hydration failure diagnostic');
  });
});
