import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalInBackpackProject, evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';

const projectSource = process.env['PAPERS_PENCILCASE_PROJECT'];
describe.runIf(Boolean(projectSource))('Pencilcase installed tool ownership', () => {
  const id = 'bp-dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let root: string, launched: LaunchedApp;
  const page = <T>(script: string) => evalInBackpackProject<T>(launched.app, script);
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'papers-pencilcase-e2e-'));
    const data = join(root, 'PapersData'), project = join(root, 'pencilcase');
    await fs.mkdir(join(data, 'backpacks', id), { recursive: true });
    await fs.cp(join(projectSource!, 'public'), join(project, 'public'), { recursive: true });
    await fs.writeFile(join(project, 'package.json'), JSON.stringify({ name: 'pencilcase-backpack' }));
    await fs.writeFile(join(project, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: id, entry: 'public/index.html' }));
    const backpack = { id, name: 'Pencilcase', type: 'environment', createdAt: new Date().toISOString(), archived: false, workspacePath: null, lastEnteredAt: null };
    await fs.writeFile(join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
    await fs.writeFile(join(data, 'backpacks', id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
    await fs.writeFile(join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [id]: { root: project } } }));
    launched = await launchPapers(root, { fixtures: false, devControlDescriptor: join(root, 'control.json') });
    await waitFor(() => evalInHost<boolean>(launched.app, 'typeof window.papersHost?.backpacks?.enter === "function"'), 20000, 'Pencilcase host');
    await evalInHost(launched.app, `[...document.querySelectorAll('.backpack-card button')].find(button=>button.textContent.trim()==='Enter').click();true`);

    await waitFor(() => page<boolean>('document.querySelectorAll(".tool").length === 15'), 20000, 'Pencilcase tool list');
  });
  afterAll(async () => {
    await launched?.close();
    if (root) { const real = await fs.realpath(root); if (dirname(real) !== await fs.realpath(tmpdir()) || !basename(real).startsWith('papers-pencilcase-e2e-')) throw new Error('Unsafe fixture path'); await fs.rm(real, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }); }
  });
  it('answers file search requests with diagnostics enabled', async () => {
    const result = await page<{ ok: boolean; provider: string; total: number }>(`(async()=>{
      const {createHostBridge}=await import('./host.js');
      const response=await createHostBridge(window).fileCapability('search',{query:'xlsx',limit:100});
      return {ok:response.ok,provider:response.provider,total:response.total};
    })()`);
    // Everything runs on the creator's desktop, so the isolated desktop may
    // return an IPC provider refusal. Either result must answer the host RPC.
    expect(typeof result.ok).toBe('boolean');
    expect(result.provider).toBe('everything');
    expect(typeof result.total).toBe('number');
  });
  it('loads a real warm engine, reports its measured usage and records the data', async () => {
    await waitFor(() => page<boolean>('!document.querySelector("[data-id=officeEditor] button").disabled'), 20000, 'runtime control');
    await page('document.querySelector("[data-id=officeEditor] button").click();true');
    await waitFor(() => page<boolean>('document.querySelector("[data-id=officeEditor] .badge").textContent === "Warm"'), 60000, 'prepared office engine');
    await waitFor(() => page<boolean>('document.querySelector("[data-id=officeEditor] .usage").textContent.includes("Memory:")'), 15000, 'measured native usage');
    await page('document.querySelector("#record").click();true');
    await waitFor(() => page<boolean>('document.querySelector("#record").textContent === "Stop recording"'), 10000, 'recording started');
    await page('document.querySelector("#record").click();true');
    await waitFor(() => page<boolean>('document.querySelectorAll(".recording").length === 1'), 10000, 'recording saved');
    const files = await fs.readdir(join(root, 'PapersData/native/capability-runtimes/recordings'));
    const sample = JSON.parse((await fs.readFile(join(root, 'PapersData/native/capability-runtimes/recordings', files[0]!), 'utf8')).split('\n')[0]!);
    expect(sample.capabilities.officeEditor.runtime.runtimes[0].usage.workingSetBytes).toBeGreaterThan(0);
  });
  it('opens the separate local coder view through the existing trusted relay and returns', async () => {
    await page('document.querySelector(".open-view").click();true');
    await waitFor(() => page<boolean>('location.pathname.endsWith("/coder/index.html") && !!document.querySelector(".session-app")'), 20000, 'separate coder view');
    expect(await page<string>('document.body.textContent')).not.toContain('Backpack is not authorized');
    await page('document.querySelector("nav a").click();true');
    await waitFor(() => page<boolean>('document.querySelectorAll(".tool").length === 15'), 20000, 'return to tools');
  });
  it('raises the full Backpack picker above native views and re-enters through its button', async () => {
    await evalInHost(launched.app, 'document.querySelector(".titlebar .pill-button").click();true');
    await waitFor(() => evalInHost<boolean>(launched.app, '!!document.querySelector(".backpack-card")'), 10000, 'full picker');
    await waitFor(() => launched.app.evaluate(({ BaseWindow }) => {
      const children = BaseWindow.getAllWindows()[0]!.contentView.children as Electron.WebContentsView[];
      return !children[children.length - 1]!.webContents.getURL().startsWith('papers-backpack://');
    }), 10000, 'native host above project views');
    await evalInHost(launched.app, '[...document.querySelectorAll(".backpack-card button")].find(button=>button.textContent.trim()==="Enter").click();true');
    await waitFor(() => evalInHost<boolean>(launched.app, '!document.querySelector(".backpack-card")'), 10000, 'picker entered again');
  });
});
