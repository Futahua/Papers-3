import { copyFile, cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalInBackpackProject, evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';

// Run on a separate Windows desktop. A supplied document is copied into the
// isolated fixture before editing; the source is never opened by this test.
const fixture = process.env['PAPERS_NATIVE_OFFICE_FIXTURE'];
const ayg = process.env['PAPERS_AYG_PROJECT'];
const officePython = process.env['PAPERS_NATIVE_OFFICE_PYTHON'];
const run = promisify(execFile);
describe.runIf(process.platform === 'win32' && Boolean(fixture && ayg))('installed inline office capability', () => {
  let launched: LaunchedApp, document: string, fixtureRoot: string;
  const id = 'bp-cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const call = (operation: string, params: Record<string, unknown> = {}) => evalInBackpackProject<any>(launched.app,
    `window.officeCall(${JSON.stringify(operation)},${JSON.stringify(params)})`);
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-office-native-'));
    fixtureRoot = root;
    const data = join(root, 'PapersData'), backpackDir = join(data, 'backpacks', id), project = join(data, 'office-fixture');
    await mkdir(backpackDir, { recursive: true }); await mkdir(join(project, 'public'), { recursive: true });
    await cp(join(ayg!, 'public'), join(project, 'public'), { recursive: true });
    document = join(root, 'disposable.odt'); await copyFile(fixture!, document);
    const backpack = { id, name: 'Inline office fixture', type: 'environment', createdAt: '2026-10-07T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null };
    await writeFile(join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
    await writeFile(join(backpackDir, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
    await writeFile(join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [id]: { root: project } } }));
    await writeFile(join(project, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: id, entry: 'public/index.html' }));
    await writeFile(join(project, 'public/index.html'), '<!doctype html><link rel="stylesheet" href="styles/file-capability.css"><main class="workspace" style="width:1000px;height:800px"></main><script type="module" src="office-test.js"></script>');
    await writeFile(join(project, 'public/office-test.js'), `
      import { createHostBridge } from './app/host/host-bridge.js';
      import { createFileCapabilityPanel } from './app/file-capability-panel.js';
      const host = createHostBridge(window);
      window.officeCalls=[];
      window.officeCall=async(operation,params)=>{const trace={operation,params};window.officeCalls.push(trace);let result;
        if(window.failNativePreview&&operation==='preview'&&!params.skipWindowsPreview)result={ok:true,preview:{kind:'windows-preview-handler',clsid:'{11111111-1111-1111-1111-111111111111}'}};
        else if(window.failNativePreview&&operation==='preview-native-open')result={ok:false,message:'Fixture native handler failed'};
        else result=await host.fileCapability(operation,params);trace.result=result;return result;};
      window.officePane=createFileCapabilityPanel({document,host:{...host,fileCapability:window.officeCall}});
      window.officePane.setExpanded(true);`);
    launched = await launchPapers(root, { fixtures: false });
    await waitFor(async () => { try { return await evalInHost<boolean>(launched.app, 'typeof window.papersHost?.backpacks?.enter === "function"'); } catch { return false; } }, 20_000, 'office fixture host');
    await evalInHost(launched.app, `window.papersHost.backpacks.enter(${JSON.stringify(id)})`);
    await evalInHost(launched.app, `window.papersHost.backpackProject.open(${JSON.stringify(id)})`);
    await waitFor(async () => { try { return await evalInBackpackProject<boolean>(launched.app, 'typeof window.officeCall === "function"'); } catch { return false; } }, 20_000, 'office fixture project');
  });
  afterAll(async () => {
    await launched?.close();
    if (!fixtureRoot) return;
    const actual = await realpath(fixtureRoot), temporary = await realpath(tmpdir());
    if (dirname(actual) !== temporary || !basename(actual).startsWith('papers-office-native-')) throw new Error('Refusing to remove a fixture outside its temporary directory.');
    await rm(actual, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
  });
  it('falls back from a failed native handler through the actual AYG pane and scoped PDF capability', async () => {
    await evalInBackpackProject(launched.app, `window.failNativePreview=true;window.officePane.previewPath(${JSON.stringify(document)})`);
    try {
      await waitFor(() => evalInBackpackProject<boolean>(launched.app, 'window.officeCalls.some(x=>x.operation==="preview-pdf-open"&&x.result?.ok)'), 90_000, 'fallback PDF hosted');
      expect(await evalInBackpackProject(launched.app, 'window.officeCalls.find(x=>x.operation==="preview"&&x.params.skipWindowsPreview)?.result?.preview?.convertedBy')).toBe('libreoffice');
    } finally {
      await evalInBackpackProject(launched.app, 'window.failNativePreview=false;window.officePane.setExpanded(false);window.officePane.setExpanded(true);true');
    }
  });
  it('advertises the packaged helper and opens, saves, hides and closes through the real scoped project IPC', async () => {
    expect(await call('providers')).toMatchObject({ ok: true, providers: { officeEditor: true } });
    const coldStart = Date.now();
    const opened = await call('office-editor-open', { path: document, rect: { x: 20, y: 60, width: 640, height: 480 } });
    console.log('Office cold opening milliseconds', Date.now() - coldStart);
    expect(opened).toMatchObject({ ok: true, sessionId: expect.any(String) });
    if (!officePython) throw new Error('Supply LibreOffice Python to verify actual native rendering.');
    const probe = async () => JSON.parse((await run(officePython, [join(process.cwd(), 'tests/e2e/office-editor-view-probe.py'), 'papers_office_' + opened.runtimeId.replaceAll('-', '')], { windowsHide: true, timeout: 15_000 })).stdout);
    await expect.poll(probe).toMatchObject({ editorAboveSiblingViews: true, editorReceivesPaneHit: true, visible: true });
    const rendered = await probe();
    const macro = JSON.parse((await run(officePython, [join(process.cwd(), 'tests/e2e/office-editor-view-probe.py'), 'papers_office_' + opened.runtimeId.replaceAll('-', ''), '--macro-proof'], { windowsHide: true, timeout: 15_000 })).stdout);
    expect(macro).toMatchObject({ macrosEnabled: true, macroResult: 42 });
    expect(rendered.contentViewSize[0]).toBeGreaterThan(100);
    expect(rendered.contentViewSize[1]).toBeGreaterThan(100);
    await expect.poll(async () => (await probe()).paintedColors).toBeGreaterThan(2);
    expect(await call('office-editor-move', { sessionId: opened.sessionId, rect: { x: 30, y: 70, width: 500, height: 400 } })).toMatchObject({ ok: true });
    expect(await call('office-editor-visible', { sessionId: opened.sessionId, visible: false })).toMatchObject({ ok: true });
    expect(await call('office-editor-visible', { sessionId: opened.sessionId, visible: true })).toMatchObject({ ok: true });
    await expect.poll(probe).toMatchObject({ editorAboveSiblingViews: true, editorReceivesPaneHit: true, visible: true });
    await expect.poll(async () => (await probe()).paintedColors).toBeGreaterThan(2);
    expect(await call('office-editor-save', { sessionId: opened.sessionId })).toMatchObject({ ok: true });
    expect(await call('office-editor-close', { sessionId: opened.sessionId })).toMatchObject({ ok: true, detached: false });
    const warmStart = Date.now();
    const next = await call('office-editor-open', { path: document, rect: { x: 20, y: 60, width: 640, height: 480 } });
    console.log('Office warm opening milliseconds', Date.now() - warmStart);
    expect(next).toMatchObject({ ok: true, runtimeId: opened.runtimeId });
    expect(next.sessionId).not.toBe(opened.sessionId);
    expect(await call('office-editor-save', { sessionId: opened.sessionId })).toMatchObject({ ok: false });
    await expect.poll(async () => (await probe()).paintedColors).toBeGreaterThan(2);
    expect(await call('office-editor-close', { sessionId: next.sessionId })).toMatchObject({ ok: true });
  });
  it('opens the warm editor and saves from the actual AYG pencil through its real request wrapper', async () => {
    await evalInBackpackProject(launched.app, `window.officePane.previewPath(${JSON.stringify(document)})`);
    const before = await evalInBackpackProject<number>(launched.app, 'window.officeCalls.filter(x=>x.operation==="office-editor-open").length');
    expect(await evalInBackpackProject(launched.app, `document.querySelector('[aria-label="Edit document inline"]').click();document.querySelector('progress[aria-label="Document loading progress"]')?.getAttribute('value')`)).toBeNull();
    try {
      await waitFor(() => evalInBackpackProject<boolean>(launched.app, `Boolean(document.querySelector('[aria-label="Save document"]:not([hidden])'))`), 100_000, 'AYG native editor ready through bounded RPC');
    } catch (error) {
      console.error(await evalInBackpackProject(launched.app, '({calls:window.officeCalls,text:document.body.textContent})'));
      throw error;
    }
    expect(await evalInBackpackProject(launched.app, `document.querySelector('.file-capability-editor-loading') === null`)).toBe(true);
    await evalInBackpackProject(launched.app, `document.querySelector('[aria-label="Save document"]').click();true`);
    await waitFor(() => evalInBackpackProject<boolean>(launched.app, 'document.body.textContent.includes("Saved")'), 30_000, 'AYG native save');
    await evalInBackpackProject(launched.app, 'window.officePane.setExpanded(false);window.officePane.setExpanded(true);true');
    expect(await evalInBackpackProject<number>(launched.app, 'window.officeCalls.filter(x=>x.operation==="office-editor-open").length')).toBe(before + 1);
    await evalInBackpackProject(launched.app, `document.querySelector('[aria-label="Return to document preview"]').click();true`);
    await waitFor(() => evalInBackpackProject<boolean>(launched.app, `!document.querySelector('[aria-label="Save document"]:not([hidden])')`), 30_000, 'AYG return to preview');
  });
  it('shows reported stage values and clears determinate progress when the provider has no total', async () => {
    const result = await evalInBackpackProject<any>(launched.app, `(async()=>{
      const {createEditorLoadingProgress}=await import('./app/editor-loading-progress.js');
      const container=document.createElement('div');document.body.append(container);
      let progress=null,next;
      const controller=createEditorLoadingProgress({document,container,status:async()=>progress,active:()=>true,schedule:callback=>{next=callback;return 1;},cancel:()=>{next=null;}});
      await new Promise(resolve=>setTimeout(resolve,0));
      const bar=container.querySelector('progress');const initial=bar.getAttribute('value');
      progress={text:'Reading',value:35,maximum:200};await next();const reported={value:bar.value,maximum:bar.max,text:bar.getAttribute('aria-valuetext')};
      progress={text:'Preparing',value:null,maximum:null};await next();const unknown=bar.getAttribute('value');
      controller.stop();const removed=container.children.length===0;container.remove();
      return {initial,reported,unknown,removed};
    })()`);
    expect(result).toEqual({ initial: null, reported: { value: 35, maximum: 200, text: '17% of the current loading stage' }, unknown: null, removed: true });
  });
});
