import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { launchPapers, evalInHost,evalInHostWindow, waitFor, type LaunchedApp } from './helpers';

it('reopens unclosed Papers windows separately after process restart and parks explicitly closed windows', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-session-windows-'));
  const data = path.join(profile, 'PapersData');
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const projects = [
    { id: 'bp-11111111-1111-4111-8111-111111111111', name: 'First', key: 'page-first', workspaceId: first },
    { id: 'bp-22222222-2222-4222-8222-222222222222', name: 'Second', key: 'page-second', workspaceId: second },
    { id: 'bp-33333333-3333-4333-8333-333333333333', name: 'Third', key: 'page-third', workspaceId: second },
  ];
  const backpacks = projects.map(p => ({
    id: p.id, name: p.name, type: 'environment', createdAt: '2026-10-09T00:00:00.000Z',
    lastEnteredAt: null, archived: false, workspacePath: null,
  }));
  await fs.mkdir(data, { recursive: true });
  for (const p of projects) {
    const root = path.join(profile, p.name);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'index.html'), `<html><body>${p.name}</body></html>`);
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: p.id, entry: 'public/index.html' }));
    await fs.mkdir(path.join(data, 'backpacks', p.id), { recursive: true });
    await fs.writeFile(path.join(data, 'backpacks', p.id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpacks.find(b => b.id === p.id) }));
  }
  await fs.writeFile(path.join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }));
  await fs.writeFile(path.join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1,
    projects: Object.fromEntries(projects.map(p => [p.id, { root: path.join(profile, p.name) }])) }));
  const topology = (p: typeof projects[number]) => ({
    schemaVersion: 1, surfaces: projects.filter(s=>s.workspaceId===p.workspaceId).map(s=>({ surfaceId: `runtime-${s.key}`, surfaceKey: s.key, projectId: s.id, title: s.name })),
    groups: [{ groupId: 'group-main', surfaceIds: projects.filter(s=>s.workspaceId===p.workspaceId).map(s=>`runtime-${s.key}`), activeSurfaceId: `runtime-${p.key}` }],
    root: { kind: 'group', groupId: 'group-main' }, focusedGroupId: 'group-main',
  });
  await fs.writeFile(path.join(data, 'workspace-topologies.json'), JSON.stringify({
    schemaVersion: 2, lastWorkspaceId: first,
    workspaces: projects.filter((p,i)=>projects.findIndex(s=>s.workspaceId===p.workspaceId)===i).map((p, i) => ({ workspaceId: p.workspaceId, topology: topology(p),
      session: true, window: { parked: false, bounds: { x: 30 + i * 70, y: 50 + i * 70, width: 1100, height: 730 } },
      updatedAt: '2026-10-09T00:00:00.000Z' })),
  }));

  let launched: LaunchedApp | null = null;
  const findWindows = async () => {
    if (!launched) throw new Error('Papers fixture is not running');
    return evalInHost<Array<{ windowId: number }>>(launched.app, 'papersHost.app.windows()');
  };
  const findPages = async () => {
    if (!launched) throw new Error('Papers fixture is not running');
    return evalInHost<Array<{ key: string; windowId: number | null }>>(launched.app, 'papersHost.app.pages()');
  };
  try {
    for (let restart = 0; restart < 2; restart++) {
      launched = await launchPapers(profile, { fixtures: false });
      await waitFor(async () => (await findWindows()).length === 2, 25000, 'two separate Papers windows');
      await waitFor(async () => {
        const pages = await findPages();
        return pages.length === 3 && pages.every(p => p.windowId !== null)
          && new Set(pages.map(p => p.windowId)).size === 2;
      }, 25000, 'distinct restored window owners');
      expect((await findPages()).map(p => p.key).sort()).toEqual(['page-first', 'page-second','page-third']);
      const saved = JSON.parse(await fs.readFile(path.join(data, 'workspace-topologies.json'), 'utf8')) as {
        workspaces: Array<{ workspaceId: string; window: { parked: boolean } }>;
      };
      expect(saved.workspaces.filter(w => !w.window?.parked).map(w => w.workspaceId).sort()).toEqual([first, second]);
      if (restart === 0) {
        await launched.app.evaluate(({ app }) => { app.quit(); });
        await launched.close();
        launched = null;
      }
    }

    const toPark = (await findPages()).find(p => p.key === 'page-second')!.windowId!;
    await launched!.app.evaluate(({ BaseWindow }, id) => { BaseWindow.getAllWindows().find(w => w.id === id)?.close(); }, toPark);
    await waitFor(async () => (await findWindows()).length === 1, 18000, 'explicitly closed secondary window');
    const parked = await findPages();
    expect(parked.find(p => p.key === 'page-second')?.windowId).toBeNull();
    await launched!.app.evaluate(({ app }) => { app.quit(); });
    await launched!.close();launched = null;

    launched = await launchPapers(profile, { fixtures: false });
    await waitFor(async () => (await findWindows()).length === 1, 25000, 'closed window stays parked after restart');
    expect((await findPages()).find(p => p.key === 'page-second')?.windowId).toBeNull();
    await evalInHost(launched.app, `document.querySelector('[aria-label="Pages"]').click()`);
    await waitFor(()=>evalInHost<boolean>(launched!.app, `Array.from(document.querySelectorAll('.saved-page-row [role="menuitem"]')).some(button=>button.textContent==='Second · saved')`),5000,'saved page menu entry');
    expect(await evalInHost<boolean>(launched.app, `(()=>{const button=Array.from(document.querySelectorAll('.saved-page-row [role="menuitem"]')).find(button=>button.textContent==='Second · saved');return !!button&&!button.disabled&&button.title==='Reopen saved page';})()`)).toBe(true);
    await evalInHost(launched.app, `Array.from(document.querySelectorAll('.saved-page-row [role="menuitem"]')).find(button=>button.textContent==='Second · saved').click()`);
    await waitFor(async () => (await findWindows()).length === 2, 25000, 'saved parked window manually reopened');
    expect((await findPages()).find(page=>page.key==='page-second')?.windowId).not.toBeNull();
    expect(await evalInHost<boolean>(launched.app, `!document.querySelector('.pages-menu')`)).toBe(true);
    const liveFirst=(await findPages()).find(p=>p.key==='page-first')!.windowId!;
    const liveSecond=(await findPages()).find(p=>p.key==='page-second')!.windowId!;
    expect((await findPages()).find(p=>p.key==='page-third')!.windowId).toBe(liveSecond);
    await launched.app.evaluate(({BaseWindow},id)=>BaseWindow.getAllWindows().find(w=>w.id===id)!.close(),liveSecond);
    await waitFor(async()=>(await findWindows()).length===1,18000,'park siblings again');
    await evalInHost(launched.app,`document.querySelector('[aria-label="Pages"]').click()`);
    await waitFor(()=>evalInHost<boolean>(launched!.app,`document.querySelectorAll('[data-saved-page]').length===2`),5000,'only unopened pages shown');
    expect(await evalInHost<number>(launched.app,`document.querySelectorAll('.saved-page-group').length`)).toBe(1);
    await evalInHost(launched.app,`(()=>{window.savedDrag=new DataTransfer();document.querySelector('[data-saved-page="page-third"]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:savedDrag,bubbles:true}));})()`);
    await waitFor(()=>evalInHost<boolean>(launched!.app,`papersHost.app.windowDragState().then(s=>s?.key==='page-third')`),5000,'saved page drag registered');
    await evalInHost(launched.app,`(()=>{const g=document.querySelector('[data-papers-group-id="group-main"]'),r=g.getBoundingClientRect();g.dispatchEvent(new DragEvent('dragover',{dataTransfer:savedDrag,clientX:r.right-4,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));})()`);
    await waitFor(()=>evalInHost<boolean>(launched!.app,`document.querySelector('.papers-container-drop').getAttribute('aria-label')==='Open page right'`),5000,'saved split strip cue');
    await evalInHost(launched.app,`(()=>{const g=document.querySelector('[data-papers-group-id="group-main"]'),r=g.getBoundingClientRect();g.dispatchEvent(new DragEvent('drop',{dataTransfer:savedDrag,clientX:r.right-4,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));})()`);
    await waitFor(async()=>(await findPages()).find(p=>p.key==='page-third')?.windowId===liveFirst,10000,'only dragged page opened in destination');
    await evalInHost(launched.app,`document.dispatchEvent(new DragEvent('dragend',{dataTransfer:savedDrag,bubbles:true}))`);
    expect((await findPages()).find(p=>p.key==='page-second')?.windowId).toBeNull();
    const remaining=JSON.parse(await fs.readFile(path.join(data,'workspace-topologies.json'),'utf8')).workspaces.find((w:any)=>w.workspaceId===second);
    expect(remaining.topology.surfaces.map((s:any)=>s.surfaceKey)).toEqual(['page-second']);
    await evalInHost(launched.app,`papersHost.app.showPage('page-second')`);
    const restoredSecond=(await findPages()).find(p=>p.key==='page-second')!.windowId!;
    await launched.app.evaluate(({BaseWindow},ids)=>{BaseWindow.getAllWindows().find(w=>w.id===ids.a)!.setBounds({x:10,y:30,width:1000,height:700});BaseWindow.getAllWindows().find(w=>w.id===ids.b)!.setBounds({x:80,y:80,width:1100,height:750});},{a:liveFirst,b:restoredSecond});
    const bounds=()=>launched!.app.evaluate(({BaseWindow},ids)=>ids.map(id=>BaseWindow.getAllWindows().find(w=>w.id===id)!.getBounds()),[liveFirst,restoredSecond]);
    const original=await bounds();
    const drag=await evalInHostWindow<Array<[string,string]>>(launched.app,liveFirst,`(()=>{window.windowDrag=new DataTransfer();document.querySelector('[data-window-grip]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:windowDrag,bubbles:true}));return [...windowDrag.types].map(type=>[type,windowDrag.getData(type)]);})()`);
    await waitFor(()=>evalInHostWindow<boolean>(launched!.app,restoredSecond,`papersHost.app.windowDragState().then(s=>s?.sourceId===${liveFirst})`),5000,'window drag registered');
    await evalInHostWindow(launched.app,restoredSecond,`(()=>{window.foreignDrag=new DataTransfer();for(const [type,value] of ${JSON.stringify(drag)})foreignDrag.setData(type,value);document.body.dispatchEvent(new DragEvent('dragover',{dataTransfer:foreignDrag,clientX:200,clientY:200,bubbles:true,cancelable:true}));})()`);
    await waitFor(()=>evalInHostWindow<boolean>(launched!.app,restoredSecond,`document.querySelector('.papers-container-drop').textContent==='Swap window positions'`),5000,'window swap indicator');
    await evalInHostWindow(launched.app,restoredSecond,`document.body.dispatchEvent(new DragEvent('drop',{dataTransfer:foreignDrag,clientX:200,clientY:200,bubbles:true,cancelable:true}))`);
    await waitFor(async()=>JSON.stringify(await bounds())===JSON.stringify([original[1],original[0]]),5000,'whole window bounds exchanged');
    await evalInHostWindow(launched.app,liveFirst,`document.dispatchEvent(new DragEvent('dragend',{dataTransfer:windowDrag,bubbles:true}))`);
    expect((await findPages()).find(p=>p.key==='page-third')?.windowId).toBe(liveFirst);
    // A refused window move reports to the source and never moves its geometry.
    const beforeFailure=await bounds();
    await evalInHostWindow(launched.app,liveFirst,`window.failureSeen=false;new MutationObserver(()=>{if(document.querySelector('.move-refusal-feedback'))failureSeen=true}).observe(document.body,{childList:true});papersHost.app.swapWindow(${liveFirst},true)`);
    await waitFor(()=>evalInHostWindow<boolean>(launched!.app,liveFirst,'failureSeen'),3000,'refused move flashes source window');
    expect(await bounds()).toEqual(beforeFailure);
    await waitFor(()=>evalInHostWindow<boolean>(launched!.app,liveFirst,`!document.querySelector('.move-refusal-feedback')`),2000,'refusal cue expires');

  } finally {
    if(launched){const closing=launched.close();await Promise.race([closing,new Promise<void>(resolve=>setTimeout(()=>{if(launched?.app.process().exitCode===null)launched.app.process().kill();resolve();},12000))]);}
    await fs.rm(profile, { recursive: true, force: true });
  }
});
