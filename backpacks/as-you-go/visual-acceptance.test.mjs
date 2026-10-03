import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { VISUAL_FIXTURE_KEYS, fixtureGeometryPasses } from './public/app/visual-fixture-contract.js';

const papersRoot = process.env.PAPERS_SOURCE_ROOT || 'D:/Letters/MatTroiSeConMoc/Products/Papers/Source';
const executable = process.env.PAPERS_PACKAGED_EXE;
const acceptance = executable ? test : test.skip;

function zipEntries(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder(); let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true); const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true); const nameStart = offset + 30; const dataStart = nameStart + nameLength + extraLength;
    entries.set(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)), bytes.slice(dataStart, dataStart + size)); offset = dataStart + size;
  }
  return entries;
}

acceptance('packaged Papers observes the As you Go success and failure fixtures', async () => {
  const require = createRequire(join(papersRoot, 'package.json'));
  const { _electron: electron } = require('playwright-core');
  const { connectPapersControl, readDescriptor } = await import(pathToFileURL(resolve(papersRoot, 'tools/papersControlClient.mjs')).href);
  const profile = await mkdtemp(join(tmpdir(), 'as-you-go-visual-'));
  const descriptor = join(profile, 'dev-control.json');
  const projectRoot = join(profile, 'project');
  const sourceRoot = fileURLToPath(new URL('./test-fixtures/visual/', import.meta.url));
  const productionPublic = fileURLToPath(new URL('./public/', import.meta.url));
  const projectId = 'bp-22222222-2222-4222-8222-222222222222';
  await mkdir(join(profile, 'PapersData', 'backpacks', projectId), { recursive: true });
  await mkdir(join(projectRoot, 'public'), { recursive: true });
  await cp(productionPublic, join(projectRoot, 'public'), { recursive: true });
  for (const fixtureFile of ['failure.html', 'fixture-failure.js']) {
    await cp(join(sourceRoot, 'public', fixtureFile), join(projectRoot, 'public', fixtureFile));
  }
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: projectId, entry: 'public/workspace-20260730b.html' }));
  const fixtureState = JSON.parse(await readFile(join(sourceRoot, 'non-empty-state.json'), 'utf8'));
  await writeFile(join(projectRoot, 'state.json'), `${JSON.stringify(fixtureState.state, null, 2)}\n`);
  await writeFile(join(profile, 'PapersData', 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: projectId, name: 'Visual fixture', type: 'environment', createdAt: '2026-09-03T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
  await writeFile(join(profile, 'PapersData', 'backpacks', projectId, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: projectId, name: 'Visual fixture', type: 'environment', createdAt: '2026-09-03T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
  await writeFile(join(profile, 'PapersData', 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [projectId]: { root: projectRoot } } }));
  const app = await electron.launch({ executablePath: executable, args: ['--force-prefers-reduced-motion=1', '--lang=en-US'], cwd: papersRoot, env: { ...process.env, PAPERS_TEST_USER_DATA: profile, PAPERS_ENABLE_FIXTURES: '0', PAPERS_DEV_CONTROL: '1', PAPERS_DEV_CONTROL_DESCRIPTOR: descriptor, ELECTRON_ENABLE_LOGGING: '1' } });
  const wait = async (probe, timeout = 15000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await probe()) return; await new Promise((r) => setTimeout(r, 100)); } const urls = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap((window) => window.contentView.children.map((view) => view.webContents.getURL()))); throw new Error(`visual acceptance timeout; urls=${JSON.stringify(urls)}`); };
  const call = async (method, params = {}) => { const connection = await connectPapersControl(await readDescriptor(descriptor)); try { const result = await connection.call(method, params); if (!result.ok) throw new Error(result.error || method); return result.result; } finally { connection.close(); } };
  const readArtifact = async (artifactId) => { const chunks = []; let offset = 0; let done = false; while (!done) { const chunk = await call('visual.artifact.read', { artifactId, offset, length: 1024 }); chunks.push(Buffer.from(chunk.bytesBase64, 'base64')); offset = chunk.nextOffset; done = chunk.done; } return Buffer.concat(chunks); };
  const evalHost = async (script) => app.evaluate(async ({ BaseWindow }, source) => { const host = BaseWindow.getAllWindows()[0].contentView.children[0]; if (!host) throw new Error('host view unavailable'); return host.webContents.executeJavaScript(source, true); }, script);
  const evalProject = async (script) => app.evaluate(async ({ BaseWindow }, source) => { const project = BaseWindow.getAllWindows()[0].contentView.children.find((view) => view.webContents.getURL().startsWith('papers-backpack://')); if (!project) throw new Error('project view unavailable'); return project.webContents.executeJavaScript(source, true); }, script);
  try {
    await wait(async () => { try { await readFile(descriptor); return true; } catch { return false; } });
    const windowId = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.id);
    await app.evaluate(({ BaseWindow }) => { const window = BaseWindow.getAllWindows()[0]; window?.setBounds({ x: 0, y: 0, width: 1280, height: 800 }); });
    const opened = await evalHost("window.papersHost.backpackProject.open('bp-22222222-2222-4222-8222-222222222222')");
    await evalHost(`window.papersHost.backpackProject.showSurface(${JSON.stringify(opened.surfaceId)}, ${JSON.stringify(opened.url)})`);
    await evalHost(`window.papersHost.layout.commitWorkspaceTopology(${JSON.stringify({ schemaVersion: 1, surfaces: [{ surfaceId: opened.surfaceId, projectId, title: 'Visual fixture' }], groups: [{ groupId: 'fixture-group', surfaceIds: [opened.surfaceId], activeSurfaceId: opened.surfaceId }], root: { kind: 'group', groupId: 'fixture-group' }, focusedGroupId: 'fixture-group' })})`);
    await wait(async () => { const result = await call('inspect.visual.elements', { windowId, surfaceId: opened.surfaceId }); return fixtureGeometryPasses(result.elements); });
    const elements = await call('inspect.visual.elements', { windowId, surfaceId: opened.surfaceId, keys: VISUAL_FIXTURE_KEYS });
    assert.equal(fixtureGeometryPasses(elements.elements), true);
    const profile = await evalProject('({ width: innerWidth, height: innerHeight, theme: document.documentElement.dataset.theme, transparent: document.documentElement.dataset.transparentBackground, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, locale: navigator.language, activeAnimations: document.getAnimations().length, fontFamily: getComputedStyle(document.body).fontFamily })');
    assert.deepEqual(profile, { width: 1280, height: 760, theme: 'light', transparent: 'false', reducedMotion: false, locale: 'en-US', activeAnimations: 0, fontFamily: '"Segoe UI", Arial, sans-serif' });
    const healthy = await call('visual.report.create', { windowId, surfaceId: opened.surfaceId, include: { surfaceCapture: true, semanticElements: true, recentLifecycle: true, recentDiagnostics: true, timeline: true }, beforeMs: 10000 });
    assert.equal(typeof healthy.artifactId, 'string');
    const healthyBytes = await readArtifact(healthy.artifactId);
    assert.equal(createHash('sha256').update(healthyBytes).digest('hex'), healthy.sha256);
    assert.equal(healthyBytes[0], 80);
    const healthyPng = zipEntries(healthyBytes).get('surface.png');
    assert.ok(healthyPng && healthyPng[0] === 137 && healthyPng[1] === 80);
    assert.ok(zipEntries(healthyBytes).has('manifest.json'));
    const baseline = JSON.parse(await readFile(join(sourceRoot, 'baseline.json'), 'utf8'));
    const baselineHash = createHash('sha256').update(healthyPng).digest('hex');
    if (process.env.UPDATE_VISUAL_BASELINES === '1') {
      baseline.pngSha256 = baselineHash;
      await writeFile(join(sourceRoot, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
    }
    assert.equal(baseline.pngSha256, baselineHash);
    const failureUrl = `papers-backpack://bp-22222222-2222-4222-8222-222222222222/public/failure.html`;
    await evalHost(`window.papersHost.backpackProject.showSurface(${JSON.stringify(opened.surfaceId)}, ${JSON.stringify(failureUrl)})`);
    await wait(async () => await app.evaluate(async ({ BaseWindow }) => { const project = BaseWindow.getAllWindows()[0].contentView.children.find((view) => view.webContents.getURL().includes('failure.html')); return project ? await project.webContents.executeJavaScript('document.title === "" || typeof window.__asYouGoVisualFixtureReportFailure === "function"', true) : false; }));
    await wait(async () => (await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId })).some(({ payload }) => payload.kind === 'lifecycle' && payload.phase === 'render-failed' && payload.revision === 'fixture-visual-failure-v1'), 20000);
    const failureDiagnostics = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId });
    assert.ok(failureDiagnostics.some(({ payload }) => payload.kind === 'lifecycle' && payload.phase === 'state-hydrated'));
    assert.ok(failureDiagnostics.some(({ payload }) => payload.kind === 'hydration-failed'));
    const failure = await call('visual.report.create', { windowId, surfaceId: opened.surfaceId, include: { surfaceCapture: true, semanticElements: true, recentLifecycle: true, recentDiagnostics: true, timeline: true }, beforeMs: 10000 });
    assert.equal(typeof failure.artifactId, 'string');
    const failureBytes = await readArtifact(failure.artifactId);
    assert.equal(createHash('sha256').update(failureBytes).digest('hex'), failure.sha256);
    assert.equal(failureBytes[0], 80);
    const failureEntries = zipEntries(failureBytes);
    assert.ok(failureEntries.has('surface.png'));
    assert.ok(failureEntries.has('diagnostics.ndjson'));
    const failurePng = failureEntries.get('surface.png');
    assert.equal(failurePng.readUInt32BE(16), baseline.dimensions.width);
    assert.equal(failurePng.readUInt32BE(20), baseline.dimensions.height);
    const failureLifecycle = new TextDecoder().decode(failureEntries.get('lifecycle.ndjson'));
    const failureDiagnosticsText = new TextDecoder().decode(failureEntries.get('diagnostics.ndjson'));
    for (const token of ['fixture-visual-failure-v1', 'state-hydrated', 'groups', 'shortcuts', 'first-paint', 'layout-stable', 'render-failed']) assert.match(failureLifecycle, new RegExp(token));
    for (const token of ['fixture-visual-failure-v1', 'hydration-failed']) assert.match(failureDiagnosticsText, new RegExp(token));
  } finally { await app.close(); }
});
