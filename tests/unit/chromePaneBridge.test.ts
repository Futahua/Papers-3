import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const h = vi.hoisted(() => ({ children: [] as any[], spawn: vi.fn(), compile: vi.fn(), writes: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: h.spawn, execFileSync: h.compile }));
vi.mock('node:fs', () => ({ existsSync: () => true, readFileSync: (_p: string, encoding?: string) => encoding ? 'old-stamp' : Buffer.from('native-source'), mkdirSync: vi.fn(), writeFileSync: h.writes }));
vi.mock('../../src/main/windows/foregroundBridge', () => ({ resolveWindowsCscPath: () => 'X:/compiler/csc.exe' }));
import { createChromePaneBridge } from '../../src/main/backpacks/chromePaneBridge';

const platform = process.platform;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  h.children.length = 0; h.spawn.mockReset(); h.compile.mockClear();
  h.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), commands: [] as any[] });
    child.stdin.on('data', data => {
      const request = JSON.parse(data.toString()); child.commands.push(request);
      queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result: { ok: true, reused: true } }) + '\n'));
    });
    h.children.push(child); return child;
  });
});
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }); });
const bounds = { x: 20, y: 30, width: 400, height: 500 };
const context = (ownerKey: string, parentHwnd = '456') => ({ ownerKey, parentHwnd, surfaceBounds: { x: 10, y: 15, width: 1000, height: 800 } });

it('legacy pane teardown cannot hide a mounted native composition', async () => {
  const bridge = createChromePaneBridge({ cacheDirectory: 'X:/cache', nativeDirectory: 'X:/native' })!;
  await bridge.coordinator!.mount(context('1:ayg'), bounds, 32);
  const child = h.children[0]; const before = child.commands.length;
  bridge.setPaneVisible('1:ayg', false);
  bridge.setPaneVisible('1:ayg', true);
  await bridge.coordinator!.command('1:ayg', 'snapshot');
  expect(child.commands.slice(before).map((c: any) => c.op)).toEqual(['snapshot']);
  bridge.setOwnerVisible('1:ayg', false);
  await bridge.coordinator!.command('1:ayg', 'present', { visible: false });
  expect(child.commands.at(-1)).toMatchObject({ op: 'present', visible: false });
  bridge.setOwnerVisible('1:ayg', true);
  await bridge.coordinator!.command('1:ayg', 'snapshot');
  expect(child.commands.findLast((c: any) => c.op === 'present')).toMatchObject({ visible: true });
  await bridge.coordinator!.dispose();
});

it('attaching an application creates no Chrome tab and routes retained tabs to the active view', async () => {
  const onTabs = vi.fn();
  const bridge = createChromePaneBridge({ cacheDirectory: 'X:/cache', nativeDirectory: 'X:/native', onTabs })!;
  await bridge.attachWindow!(context('1:first'), 789, 123, bounds);
  expect(h.children[0].commands.some((command: any) => command.op === 'open')).toBe(false);
  expect(h.children[0].commands.at(-1)).toMatchObject({ op: 'attach', handle: 789, pid: 123 });
  await bridge.attachWindow!(context('1:second'), 790, 124, bounds);
  expect(h.spawn).toHaveBeenCalledTimes(1);
  const tabs = [{ id: 'peer-1', title: 'Writer', active: true }];
  h.children[0].stdout.write(JSON.stringify({ kind: 'tabs', tabs }) + '\n');
  expect(onTabs).toHaveBeenLastCalledWith('1:second', tabs);
  await bridge.selectTab!('1:second', 'peer-1');
  await bridge.detachTab!('1:second', 'peer-1');
  expect(h.children[0].commands.slice(-2)).toMatchObject([{ op: 'select', tabId: 'peer-1' }, { op: 'detach', tabId: 'peer-1' }]);
  bridge.dispose();
});

it('view switches retain one helper and route native edge updates to the current view', async () => {
  const onLayout = vi.fn();
  const bridge = createChromePaneBridge({ cacheDirectory: 'X:/cache', nativeDirectory: 'X:/native', onLayout })!;
  await bridge.open(context('1:first'), 'shortcut:link', 'https://example.com/', bounds);
  await bridge.open(context('1:second'), 'workspace:resume', 'https://google.com/', bounds);
  expect(h.spawn).toHaveBeenCalledTimes(1);
  const child = h.children[0];
  child.stdout.write(JSON.stringify({ kind: 'layout', rect: { x: 300, y: 45, width: 700, height: 500 } }) + '\n');
  expect(onLayout).toHaveBeenLastCalledWith('1:second', { x: 290, y: 30, width: 700, height: 500 });
  bridge.closeOwner('1:first');
  bridge.setPaneVisible('1:second', true);
  expect(child.commands.at(-1)).toMatchObject({ op: 'visible', visible: true });
  expect(child.commands.some((c: any) => c.op === 'release')).toBe(false);
  expect(child.commands.filter((c: any) => c.op === 'open').at(-1).source).toBe('workspace:resume');
  bridge.dispose();
});

it('persisted tab records use the Papers window identity across changing surface IDs', async () => {
  const first = createChromePaneBridge({ cacheDirectory: 'X:/cache', nativeDirectory: 'X:/native' })!;
  await first.open(context('1:old-surface'), 'shortcut:link', 'https://example.com/', bounds);
  const savedFile = h.spawn.mock.calls[0]![1][3]; first.dispose();
  const second = createChromePaneBridge({ cacheDirectory: 'X:/cache', nativeDirectory: 'X:/native' })!;
  await second.open(context('1:new-surface'), 'shortcut:link', 'https://example.com/', bounds);
  expect(h.spawn.mock.calls[1]![1][3]).toBe(savedFile);
  second.dispose();
});
it('native left-edge feedback preserves outer edge anchors during owner resize', async () => {
  const bridge = createChromePaneBridge({ cacheDirectory: 'X:/cache', nativeDirectory: 'X:/native' })!;
  await bridge.open(context('1:view'), 'shortcut:link', 'https://example.com/', { ...bounds, rightInset: 9, bottomInset: 9 });
  const child = h.children[0];
  child.stdout.write(JSON.stringify({ kind: 'layout', rect: { x: 300, y: 45, width: 700, height: 500 } }) + '\n');
  bridge.setOwnerSurfaceBounds('1:view', { x: 10, y: 15, width: 1920, height: 1080 });
  expect(child.commands.at(-1)).toMatchObject({ op: 'rect', rightInset: 9, bottomInset: 9 });
  bridge.dispose();
});

it('hidden Backpack initialization and late updates cannot steal the visible group', async () => {
  const onTabs=vi.fn();const bridge=createChromePaneBridge({cacheDirectory:'X:/cache',nativeDirectory:'X:/native',onTabs})!;
  bridge.setOwnerVisible('1:ayg',true);await bridge.open(context('1:ayg'),'workspace:attach','',bounds);
  bridge.setOwnerVisible('1:proxima',false);
  const child=h.children[0];const before=child.commands.length;
  await bridge.open(context('1:proxima'),'workspace:attach','',bounds);
  bridge.move('1:proxima',{...bounds,width:99});bridge.setPaneVisible('1:proxima',false);
  expect(child.commands.length).toBe(before);expect(h.spawn).toHaveBeenCalledTimes(1);
  child.stdout.write(JSON.stringify({kind:'tabs',tabs:[{id:'saved',title:'Writer',active:true}]})+'\n');
  expect(onTabs).toHaveBeenLastCalledWith('1:ayg',expect.any(Array));
  bridge.dispose();
});
it('presentation transfers retained tabs and switching back remains selectable', async () => {
  const onTabs=vi.fn();const bridge=createChromePaneBridge({cacheDirectory:'X:/cache',nativeDirectory:'X:/native',onTabs})!;
  bridge.setOwnerVisible('1:ayg',true);await bridge.open(context('1:ayg'),'workspace:attach','',bounds);
  bridge.setOwnerVisible('1:proxima',false);await bridge.open(context('1:proxima'),'workspace:attach','',bounds);
  const child=h.children[0];bridge.setOwnerVisible('1:proxima',true);bridge.setPaneVisible('1:proxima',true);
  bridge.setOwnerVisible('1:ayg',false);
  await bridge.selectTab!('1:proxima','saved');expect(child.commands.at(-1)).toMatchObject({op:'select',tabId:'saved'});
  const before=child.commands.length;await bridge.open(context('1:ayg'),'workspace:resume','https://example.com/',bounds);expect(child.commands.length).toBe(before);
  bridge.setOwnerVisible('1:ayg',true);bridge.setPaneVisible('1:ayg',true);await bridge.selectTab!('1:ayg','other');
  expect(child.commands.at(-1)).toMatchObject({op:'select',tabId:'other'});expect(h.spawn).toHaveBeenCalledTimes(1);
  bridge.closeOwner('1:proxima');expect(child.commands.some((c:any)=>c.op==='release')).toBe(false);
  bridge.dispose();expect(child.commands.at(-1)).toMatchObject({op:'release'});
});


it('Backpacks keep independent native helpers, membership files and tab events', async () => {
  const onTabs=vi.fn();
  const bridge=createChromePaneBridge({cacheDirectory:'X:/cache',nativeDirectory:'X:/native',onTabs})!;
  const ayg={...context('1:ayg'),paneGroup:'ayg'};
  const proxima={...context('1:proxima'),paneGroup:'proxima'};
  bridge.setOwnerVisible('1:ayg',true);
  await bridge.open(ayg,'workspace:attach','',bounds);
  bridge.setOwnerVisible('1:proxima',true);
  await bridge.open(proxima,'workspace:attach','',bounds);
  expect(h.spawn).toHaveBeenCalledTimes(2);
  expect(h.spawn.mock.calls[0]![1][3]).not.toBe(h.spawn.mock.calls[1]![1][3]);
  expect(h.children[0].commands.at(-1)).toMatchObject({op:'visible',visible:false});
  h.children[1].stdout.write(JSON.stringify({kind:'tabs',tabs:[{id:'own',title:'Proxima',active:true}]})+'\n');
  expect(onTabs).toHaveBeenLastCalledWith('1:proxima',expect.any(Array));
  bridge.closeOwner('1:proxima');
  expect(h.children[1].commands.at(-1)).toMatchObject({op:'release'});
  expect(h.children[0].commands.some((command:any)=>command.op==='release')).toBe(false);
  bridge.setOwnerVisible('1:ayg',true);
  await bridge.selectTab!('1:ayg','original');
  expect(h.children[0].commands.at(-1)).toMatchObject({op:'select',tabId:'original'});
  bridge.dispose();
});

it('Backpack membership survives replacement surfaces without crossing Backpack identity', async () => {
  const bridge=createChromePaneBridge({cacheDirectory:'X:/cache',nativeDirectory:'X:/native'})!;
  await bridge.open({...context('1:old'),paneGroup:'proxima'},'workspace:attach','',bounds);
  const saved=h.spawn.mock.calls[0]![1][3];
  bridge.closeOwner('1:old');
  await bridge.open({...context('1:new'),paneGroup:'proxima'},'workspace:attach','',bounds);
  expect(h.spawn.mock.calls[1]![1][3]).toBe(saved);
  bridge.dispose();
});
