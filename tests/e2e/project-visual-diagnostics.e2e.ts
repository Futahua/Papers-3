import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  await writeFile(join(projectRoot, 'public', 'index.html'), '<!doctype html><script src="app.js"></script><main data-papers-visual-key="canvas.root"><h1 data-papers-visual-key="title.main">Neutral project</h1></main>');
  await writeFile(join(projectRoot, 'public', 'empty.html'), '<!doctype html><title>Empty visual fixture</title><main>Empty</main>');
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
    const initialLifecycle = (await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
      sequence: number; payload: { kind?: string; phase?: string };
    }>).filter((record) => record.sequence > beforeSequence && record.payload.kind === 'lifecycle');
    const navigationStartedIndex = initialLifecycle.findIndex((record) => record.payload.phase === 'navigation-started');
    const domReadyIndex = initialLifecycle.findIndex((record) => record.payload.phase === 'dom-ready');
    expect(navigationStartedIndex).toBeGreaterThanOrEqual(0);
    expect(domReadyIndex).toBeGreaterThan(navigationStartedIndex);
    expect(await evalInBackpackProject(launched.app, 'Boolean(window.__papersVisualDiagnosticObserverV1)')).toBe(true);
    expect(await evalInBackpackProject(launched.app,
      `typeof window.papersVisualDiagnosticBridgeV1?.reportFirstPaint`)).toBe('undefined');
    await waitFor(async () => {
      const result = await call('inspect.visual.elements', {
        windowId, surfaceId: opened.surfaceId,
      }) as { elements: Array<{ key: string }> };
      return result.elements.some(({ key }) => key === 'canvas.root')
        && result.elements.some(({ key }) => key === 'title.main');
    }, 10_000, 'initial semantic-key observation');
    await expect(call('inspect.visual.elements', {
      windowId, surfaceId: opened.surfaceId, selector: '[data-papers-visual-key="canvas.root"]',
    })).rejects.toThrow();
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
    const availableAssertions = await call('visual.assert', {
      windowId, surfaceId: opened.surfaceId,
      assertions: [{ kind: 'visible', elementKey: 'canvas.root' }],
    }) as { available?: boolean; allPassed: boolean; assertions: Array<{ kind: string; passed: boolean }> };
    expect(availableAssertions.available).toBe(true);
    expect(availableAssertions.allPassed).toBe(true);
    expect(availableAssertions.assertions).toEqual([{ kind: 'visible', passed: true }]);
    const timeline = await call('inspect.visual.timeline', {
      windowId, surfaceId: opened.surfaceId, beforeMs: 10_000,
    }) as Array<{ target: { windowId: number; surfaceId: string }; payload: { kind?: string } }>;
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.every((entry) => entry.target.windowId === windowId && entry.target.surfaceId === opened.surfaceId)).toBe(true);
    expect(timeline.some((entry) => entry.payload.kind === 'lifecycle')).toBe(true);
    const elementCapture = await call('capture.element', {
      windowId, surfaceId: opened.surfaceId, elementKey: 'canvas.root', paddingCssPx: 4,
    }) as { consistency: { status: string }; element?: { key: string }; crop?: { width: number; height: number }; png?: { mimeType: string; size: number } };
    expect(elementCapture.consistency).toEqual({ status: 'stable' });
    expect(elementCapture.element?.key).toBe('canvas.root');
    expect(elementCapture.crop?.width).toBeGreaterThan(0);
    expect(elementCapture.crop?.height).toBeGreaterThan(0);
    expect(elementCapture.png).toEqual(expect.objectContaining({ mimeType: 'image/png', size: expect.any(Number) }));
    const preHydrationLifecycle = (await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
      sequence: number; payload: { kind?: string; phase?: string };
    }>).filter((record) => record.sequence > beforeSequence && record.payload.kind === 'lifecycle');
    expect(preHydrationLifecycle.some((record) => record.payload.phase === 'state-hydrated')).toBe(false);
    await evalInBackpackProject(launched.app,
      `window.papersVisualDiagnosticBridgeV1.reportStateHydrated('neutral-rev-1', { cards: 1, groups: 1 }); true`);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
        sequence: number; payload: { kind?: string; phase?: string; revision?: string; summary?: Record<string, number> };
      }>;
      return records.some((record) => record.sequence > beforeSequence
        && record.payload.kind === 'lifecycle' && record.payload.phase === 'state-hydrated'
        && record.payload.revision === 'neutral-rev-1');
    }, 10_000, 'project hydration success signal');
    const successfulLifecyclePhases = (await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{
      sequence: number; payload: { kind?: string; phase?: string };
    }>).filter((record) => record.sequence > beforeSequence && record.payload.kind === 'lifecycle')
      .map((record) => record.payload.phase);
    expect(successfulLifecyclePhases).toEqual(expect.arrayContaining([
      'state-hydrated', 'first-paint', 'layout-stable',
    ]));
    const captured = await call('capture.surface', { windowId, surfaceId: opened.surfaceId }) as {
      captureId: string;
      target: { windowId: number; surfaceId: string; projectId: string };
      consistency: { status: string };
      png: { artifactId: string; mimeType: string; size: number; sha256: string };
    };
    expect(captured.target).toEqual({ windowId, surfaceId: opened.surfaceId, projectId: PROJECT });
    expect(captured.consistency).toEqual({ status: 'stable' });
    expect(captured.png.mimeType).toBe('image/png');
    const composed = await call('capture.window', { windowId }) as {
      target: { windowId: number };
      consistency: { status: string };
      nativeBounds: { width: number; height: number };
      pixelSize: { width: number; height: number };
      surfaces: Array<{ surfaceId: string; projectId: string; presentation: string }>;
      png: { artifactId: string; mimeType: string; size: number };
    };
    expect(composed.target).toEqual({ windowId });
    expect(composed.consistency).toEqual({ status: 'stable' });
    expect(composed.nativeBounds.width).toBeGreaterThan(0);
    expect(composed.nativeBounds.height).toBeGreaterThan(0);
    expect(composed.pixelSize.width).toBeGreaterThan(0);
    expect(composed.pixelSize.height).toBeGreaterThan(0);
    expect(composed.surfaces).toEqual([
      expect.objectContaining({ surfaceId: opened.surfaceId, projectId: PROJECT, presentation: 'visible' }),
    ]);
    expect(composed.png.mimeType).toBe('image/png');
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let done = false;
    while (!done) {
      const chunk = await call('visual.artifact.read', {
        artifactId: captured.png.artifactId, offset, length: 1024,
      }) as { nextOffset: number; done: boolean; bytesBase64: string };
      chunks.push(new Uint8Array(Buffer.from(chunk.bytesBase64, 'base64')));
      offset = chunk.nextOffset;
      done = chunk.done;
    }
    const bytes = new Uint8Array(chunks.reduce((all, chunk) => [...all, ...chunk], [] as number[]));
    expect(bytes.byteLength).toBe(captured.png.size);
    expect(bytes[0]).toBe(137);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(captured.png.sha256);
    const report = await call('visual.report.create', {
      windowId, surfaceId: opened.surfaceId, beforeMs: 10_000,
      include: {
        surfaceCapture: true, semanticElements: true, recentLifecycle: true,
        recentDiagnostics: true, timeline: true,
      },
    }) as {
      reportId: string; artifactId: string; size: number; sha256: string;
      manifestSummary: { entryCount: number; byteSize: number; includes: { surfaceCapture: boolean } };
    };
    expect(report.reportId).toEqual(expect.any(String));
    expect(report.size).toBeGreaterThan(0);
    expect(report.manifestSummary.entryCount).toBeGreaterThanOrEqual(9);
    expect(report.manifestSummary.includes.surfaceCapture).toBe(true);
    const reportChunk = await call('visual.artifact.read', {
      artifactId: report.artifactId, offset: 0, length: 1024,
    }) as { bytesBase64: string; nextOffset: number; done: boolean };
    const reportPrefix = new Uint8Array(Buffer.from(reportChunk.bytesBase64, 'base64'));
    expect(reportPrefix[0]).toBe(0x50);
    expect(reportPrefix[1]).toBe(0x4b);
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
      expect.objectContaining({ target: { windowId, surfaceId: opened.surfaceId }, payload: expect.objectContaining({ kind: 'uncaught-error', message: 'Uncaught Error: <path> token=<redacted>' }) }),
      expect.objectContaining({ target: { windowId, surfaceId: opened.surfaceId }, payload: expect.objectContaining({ kind: 'unhandled-rejection', message: '<path> password=<redacted>' }) }),
    ]));

    // Cross-window preparation loads a new renderer before the logical surface
    // moves. Its bootstrap failures must be refused because that sender is not
    // yet canonical; after adoption, the replacement sender must be accepted.
    const second = await call('workspace.open', { windowId, projectId: PROJECT }) as { surfaceId: string };
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ surfaceId: string }>).length === 2,
      10_000, 'second project surface');
    await waitFor(async () => {
      const result = await call('inspect.visual.elements', {
        windowId, surfaceId: second.surfaceId, keys: ['canvas.root'],
      }) as { elements: Array<{ key: string }> };
      return result.elements.length === 1 && result.elements[0]?.key === 'canvas.root';
    }, 10_000, 'second same-project surface semantic-key observation');
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
    await waitFor(async () => {
      const result = await call('inspect.visual.elements', {
        windowId: secondary.windowId, surfaceId: second.surfaceId,
      }) as { elements: Array<{ key: string }> };
      return result.elements.some(({ key }) => key === 'canvas.root')
        && result.elements.some(({ key }) => key === 'title.main');
    }, 10_000, 'post-adoption semantic-key refresh');
    await expect(call('inspect.visual.elements', {
      windowId, surfaceId: second.surfaceId,
    })).rejects.toThrow(/not open/);
    const primaryTimeline = await call('inspect.visual.timeline', {
      windowId, surfaceId: opened.surfaceId, beforeMs: 10_000,
    }) as Array<{ target: { windowId: number; surfaceId: string } }>;
    const movedTimeline = await call('inspect.visual.timeline', {
      windowId: secondary.windowId, surfaceId: second.surfaceId, beforeMs: 10_000,
    }) as Array<{ target: { windowId: number; surfaceId: string } }>;
    expect(primaryTimeline.length).toBeGreaterThan(0);
    expect(movedTimeline.length).toBeGreaterThan(0);
    expect(primaryTimeline.every((entry) => entry.target.windowId === windowId && entry.target.surfaceId === opened.surfaceId)).toBe(true);
    expect(movedTimeline.every((entry) => entry.target.windowId === secondary.windowId && entry.target.surfaceId === second.surfaceId)).toBe(true);
    const finalElements = await call('inspect.visual.elements', {
      windowId, surfaceId: opened.surfaceId,
    }) as { windowId: number; surfaceId: string; layoutEpoch?: number | null; elements: Array<{ key: string; boundsCss?: { width: number; height: number }; visible?: boolean; contrast?: { status: string } }> };
    expect(finalElements.windowId).toBe(windowId);
    expect(finalElements.surfaceId).toBe(opened.surfaceId);
    expect(finalElements.layoutEpoch).toEqual(expect.any(Number));
    expect(finalElements.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'canvas.root', boundsCss: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }), visible: expect.any(Boolean) }),
      expect.objectContaining({ key: 'title.main', boundsCss: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }), visible: expect.any(Boolean) }),
    ]));
    const stagedFailures = (await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
      sequence: number; target: { surfaceId?: string }; payload: { kind?: string };
    }>).filter((record) => record.sequence > beforeTargetSequence
      && record.target.surfaceId === second.surfaceId
      && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection'));
    expect(stagedFailures).toHaveLength(0);
    await evalInProjectWindow(secondary.windowId,
      `window.location.href = ${JSON.stringify(`papers-backpack://${PROJECT}/public/empty.html`)}; true`);
    await waitFor(async () => {
      const result = await call('inspect.visual.elements', {
        windowId: secondary.windowId, surfaceId: second.surfaceId,
      }) as { elements: Array<{ key: string }> };
      return result.elements.length === 0;
    }, 10_000, 'same-renderer navigation clears semantic generation');
    const unavailableAssertions = await call('visual.assert', {
      windowId: secondary.windowId, surfaceId: second.surfaceId,
      assertions: [{ kind: 'visible', elementKey: 'canvas.root' }],
    }) as { available?: boolean; reason?: string; allPassed: boolean; assertions: unknown[] };
    expect(unavailableAssertions).toMatchObject({
      available: false, reason: 'geometry-unavailable', allPassed: false, assertions: [],
    });
    await evalInProjectWindow(secondary.windowId,
      `window.location.href = ${JSON.stringify(opened.url)}; true`);
    await waitFor(async () => {
      const result = await call('inspect.visual.elements', {
        windowId: secondary.windowId, surfaceId: second.surfaceId,
      }) as { elements: Array<{ key: string }> };
      return result.elements.some(({ key }) => key === 'canvas.root')
        && result.elements.some(({ key }) => key === 'title.main');
    }, 10_000, 'same-renderer navigation replaces semantic generation');
    await evalInProjectWindow<boolean>(secondary.windowId, 'window.__papersProjectVisualDiagnosticTestV1(); true');
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { surfaceId?: string }; payload: { kind?: string };
      }>;
      return records.filter((record) => record.sequence > beforeTargetSequence
        && record.target.surfaceId === second.surfaceId
        && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection')).length >= 2;
    }, 10_000, 'current replacement project diagnostics');
    const hydrationPairBefore = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{ sequence: number }>;
    const hydrationPairBeforeSequence = Math.max(0, ...hydrationPairBefore.map((record) => record.sequence));
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
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { surfaceId?: string }; payload: { kind?: string; phase?: string; revision?: string; stage?: string; code?: string };
      }>;
      return records.some((record) => record.sequence > beforeTargetSequence
        && record.target.surfaceId === second.surfaceId
        && record.payload.kind === 'lifecycle'
        && record.payload.phase === 'render-failed'
        && record.payload.revision === 'neutral-rev-1'
        && record.payload.stage === 'parse' && record.payload.code === 'fixture-failure');
    }, 10_000, 'current replacement hydration render-failed lifecycle');
    const hydrationPairRecords = (await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
      sequence: number; target: { windowId: number; surfaceId?: string }; payload: {
        kind?: string; phase?: string; revision?: string; stage?: string; code?: string;
      };
    }>).filter((record) => record.sequence > hydrationPairBeforeSequence
      && record.target.windowId === secondary.windowId
      && record.target.surfaceId === second.surfaceId
      && (record.payload.kind === 'hydration-failed'
        || (record.payload.kind === 'lifecycle' && record.payload.phase === 'render-failed')));
    expect(hydrationPairRecords).toHaveLength(2);
    expect(hydrationPairRecords.map((record) => record.payload.kind)).toEqual(['hydration-failed', 'lifecycle']);
    const hydrationFailureRecord = hydrationPairRecords[0]!;
    const renderFailedRecord = hydrationPairRecords[1]!;
    expect(hydrationFailureRecord.sequence).toBeLessThan(renderFailedRecord.sequence);
    expect(hydrationFailureRecord.target).toEqual({ windowId: secondary.windowId, surfaceId: second.surfaceId });
    expect(renderFailedRecord.target).toEqual({ windowId: secondary.windowId, surfaceId: second.surfaceId });
    expect(hydrationFailureRecord.payload).toMatchObject({
      kind: 'hydration-failed', revision: 'neutral-rev-1', stage: 'parse', code: 'fixture-failure',
    });
    expect(renderFailedRecord.payload).toMatchObject({
      kind: 'lifecycle', phase: 'render-failed', revision: 'neutral-rev-1', stage: 'parse', code: 'fixture-failure',
    });

    const rendererSurvivalTimeOrigin = await evalInProjectWindow<number>(secondary.windowId, 'performance.timeOrigin');
    const throwBefore = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{ sequence: number }>;
    const throwBeforeSequence = Math.max(0, ...throwBefore.map((record) => record.sequence));
    await evalInProjectWindow<boolean>(secondary.windowId, `(() => {
      setTimeout(() => { throw new Error('C:\\\\private\\\\control-survival.js token=secret'); }, 0);
      return true;
    })()`);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string };
      }>;
      return records.some((record) => record.sequence > throwBeforeSequence
        && record.target.windowId === secondary.windowId
        && record.target.surfaceId === second.surfaceId
        && record.payload.kind === 'uncaught-error'
        && record.payload.message === 'Uncaught Error: <path> token=<redacted>');
    }, 10_000, 'current replacement thrown renderer exception');
    const thrownRecords = (await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
      sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string };
    }>).filter((record) => record.sequence > throwBeforeSequence
      && record.target.windowId === secondary.windowId
      && record.target.surfaceId === second.surfaceId
      && record.payload.kind === 'uncaught-error');
    expect(thrownRecords).toHaveLength(1);
    expect(await call('inspect.workspace', { windowId: secondary.windowId })).toEqual(expect.objectContaining({
      windowId: secondary.windowId,
    }));
    expect(await evalInProjectWindow<boolean>(secondary.windowId,
      'document.body?.textContent?.includes("Neutral project") === true')).toBe(true);
    expect(await evalInProjectWindow<number>(secondary.windowId, 'performance.timeOrigin'))
      .toBe(rendererSurvivalTimeOrigin);

    await evalInProjectWindow<boolean>(secondary.windowId, `(() => {
      const script = document.createElement('script');
      script.src = 'papers-backpack://bp-11111111-1111-4111-8111-111111111111/missing-resource.js?token=resource-secret';
      document.head.appendChild(script);
      return true;
    })()`);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; resourceKind?: string; message?: string };
      }>;
      return records.some((record) => record.target.surfaceId === second.surfaceId
        && record.payload.kind === 'resource-failed' && record.payload.resourceKind === 'script');
    }, 10_000, 'current project failed script resource diagnostic');
    const resourceFailures = (await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
      target: { windowId: number; surfaceId?: string }; payload: { kind?: string; resourceKind?: string; message?: string };
    }>).filter((record) => record.target.surfaceId === second.surfaceId && record.payload.kind === 'resource-failed');
    const matchingResourceFailure = resourceFailures.find((record) => record.payload.resourceKind === 'script');
    expect(matchingResourceFailure?.target).toEqual({ windowId: secondary.windowId, surfaceId: second.surfaceId });
    expect(matchingResourceFailure?.payload).toMatchObject({ kind: 'resource-failed', resourceKind: 'script' });
    expect(JSON.stringify(resourceFailures)).not.toContain('resource-secret');
    expect(JSON.stringify(resourceFailures)).not.toContain('missing-resource.js');

    // Flood the real main-process buffer through renderer console events. The
    // buffer already contains mixed lifecycle/failure records from this
    // surface, so exceeding the default cap proves eviction in the production
    // path rather than in an isolated helper.
    const workspaceBeforePostOverflowEvents = await call('inspect.workspace', { windowId: secondary.windowId });
    const projectTimeOriginBeforePostOverflowEvents = await evalInProjectWindow<number>(
      secondary.windowId, 'performance.timeOrigin',
    );
    await evalInProjectWindow<boolean>(secondary.windowId, `(() => {
      for (let index = 0; index < 132; index += 1) console.log(\`buffer-bound-observation-\${index}\`);
      return true;
    })()`);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId, surfaceId: second.surfaceId }) as Array<{
        sequence: number; payload: { kind?: string; message?: string };
      }>;
      return records.some((record) => record.payload.kind === 'console'
        && record.payload.message === 'buffer-bound-observation-131');
    }, 10_000, 'real project diagnostic buffer overflow observations');
    const overflowRecords = await call('inspect.visual.diagnostics', {
      windowId: secondary.windowId, surfaceId: second.surfaceId,
    }) as Array<{ sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string } }>;
    expect(overflowRecords).toHaveLength(128);
    const overflowSequences = overflowRecords.map((record) => record.sequence);
    expect(overflowSequences.every((sequence, index) => index === 0 || sequence > overflowSequences[index - 1]!)).toBe(true);
    expect(overflowRecords.some((record) => record.payload.message === 'buffer-bound-observation-0')).toBe(false);
    expect(overflowRecords.some((record) => record.payload.message === 'buffer-bound-observation-131')).toBe(true);

    const diagnosticEvents: Array<{ event?: string; payload?: { sequence?: number; target?: { windowId?: number; surfaceId?: string }; payload?: { kind?: string; message?: string; resourceKind?: string } } }> = [];
    const eventConnection = await connectPapersControl(await readDescriptor(descriptorPath));
    const removeEventListener = eventConnection.onEvent((frame: {
      event?: string;
      payload?: {
        sequence?: number;
        target?: { windowId?: number; surfaceId?: string };
        payload?: { kind?: string; message?: string; resourceKind?: string };
      };
    }) => { diagnosticEvents.push(frame); });
    try {
      await expect(eventConnection.call('events.subscribe', {
        events: ['visual.diagnostic'], visualTarget: { windowId: secondary.windowId, surfaceId: second.surfaceId },
      })).resolves.toMatchObject({ ok: true, result: { subscribed: ['visual.diagnostic'] } });
      await evalInProjectWindow<boolean>(secondary.windowId, `(() => {
        console.error('buffer-bound-live-console token=resource-secret');
        Promise.reject(new Error('C:\\\\private\\\\buffer-bound.js password=secret'));
        const image = document.createElement('img');
        image.src = 'papers-backpack://bp-11111111-1111-4111-8111-111111111111/missing-bound-image.png?token=resource-secret';
        document.body.appendChild(image);
        return true;
      })()`);
      await waitFor(async () => {
        const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId, surfaceId: second.surfaceId }) as Array<{
          sequence: number; payload: { kind?: string; message?: string; resourceKind?: string };
        }>;
        return records.some((record) => record.payload.kind === 'console'
          && record.payload.message === 'buffer-bound-live-console token=<redacted>')
          && records.some((record) => record.payload.kind === 'unhandled-rejection')
          && records.some((record) => record.payload.kind === 'resource-failed' && record.payload.resourceKind === 'image');
      }, 10_000, 'post-overflow visual diagnostic publication');
      await waitFor(async () => diagnosticEvents.some((frame) => frame.event === 'visual.diagnostic'
        && frame.payload?.target?.windowId === secondary.windowId
        && frame.payload?.target?.surfaceId === second.surfaceId
        && frame.payload.payload?.kind === 'console'
        && frame.payload.payload.message === 'buffer-bound-live-console token=<redacted>')
        && diagnosticEvents.some((frame) => frame.event === 'visual.diagnostic'
          && frame.payload?.target?.windowId === secondary.windowId
          && frame.payload?.target?.surfaceId === second.surfaceId
          && frame.payload.payload?.kind === 'unhandled-rejection')
        && diagnosticEvents.some((frame) => frame.event === 'visual.diagnostic'
          && frame.payload?.target?.windowId === secondary.windowId
          && frame.payload?.target?.surfaceId === second.surfaceId
          && frame.payload.payload?.kind === 'resource-failed'
          && frame.payload.payload.resourceKind === 'image'),
      10_000, 'post-overflow visual diagnostic subscription');
    } finally {
      removeEventListener();
      eventConnection.close();
    }

    const finalRecords = await call('inspect.visual.diagnostics', {
      windowId: secondary.windowId, surfaceId: second.surfaceId,
    }) as Array<{ sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string; resourceKind?: string } }>;
    expect(finalRecords.length).toBeLessThanOrEqual(128);
    const finalSequences = finalRecords.map((record) => record.sequence);
    expect(finalSequences.every((sequence, index) => index === 0 || sequence > finalSequences[index - 1]!)).toBe(true);
    expect(finalRecords.some((record) => record.target.windowId === secondary.windowId
      && record.target.surfaceId === second.surfaceId
      && record.payload.kind === 'console'
      && record.payload.message === 'buffer-bound-live-console token=<redacted>')).toBe(true);
    expect(finalRecords.some((record) => record.target.windowId === secondary.windowId
      && record.target.surfaceId === second.surfaceId
      && record.payload.kind === 'unhandled-rejection')).toBe(true);
    expect(finalRecords.some((record) => record.target.windowId === secondary.windowId
      && record.target.surfaceId === second.surfaceId
      && record.payload.kind === 'resource-failed'
      && record.payload.resourceKind === 'image')).toBe(true);
    expect(diagnosticEvents.every((frame) => frame.event === 'visual.diagnostic'
      && frame.payload?.target?.windowId === secondary.windowId
      && frame.payload?.target?.surfaceId === second.surfaceId)).toBe(true);
    expect(JSON.stringify(finalRecords)).not.toContain('resource-secret');
    expect(JSON.stringify(finalRecords)).not.toContain('missing-bound-image.png');
    expect(JSON.stringify(finalRecords)).not.toContain('buffer-bound.js');
    const serializedDiagnosticEvents = JSON.stringify(diagnosticEvents);
    expect(serializedDiagnosticEvents).not.toContain('resource-secret');
    expect(serializedDiagnosticEvents).not.toContain('missing-bound-image.png');
    expect(serializedDiagnosticEvents).not.toContain('buffer-bound.js');
    expect(await call('inspect.workspace', { windowId: secondary.windowId })).toEqual(workspaceBeforePostOverflowEvents);
    expect(await evalInProjectWindow<number>(secondary.windowId, 'performance.timeOrigin'))
      .toBe(projectTimeOriginBeforePostOverflowEvents);

    await launched.app.evaluate(({ BaseWindow }, targetWindowId) => {
      const window = BaseWindow.getAllWindows().find((candidate) => candidate.id === targetWindowId);
      if (!window) throw new Error(`no window with id ${targetWindowId}`);
      const project = (window.contentView.children as Electron.WebContentsView[])
        .find((view) => view.webContents.getURL().startsWith('papers-backpack://'));
      if (!project) throw new Error('no project view to crash');
      project.webContents.forcefullyCrashRenderer();
    }, secondary.windowId);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId: secondary.windowId }) as Array<{
        sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; reason?: string };
      }>;
      return records.some((record) => record.target.surfaceId === second.surfaceId
        && record.payload.kind === 'renderer-gone');
    }, 10_000, 'current project renderer-gone diagnostic');
    await expect(call('inspect.visual.elements', {
      windowId: secondary.windowId, surfaceId: second.surfaceId,
    })).resolves.toEqual({ windowId: secondary.windowId, surfaceId: second.surfaceId, elements: [] });
  });
});
