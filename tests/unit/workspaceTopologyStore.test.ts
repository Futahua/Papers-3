import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceTopologyStore } from '../../src/main/persistence/workspaceTopologyStore';
import { papersPaths } from '../../src/main/persistence/paths';
import { closeWorkspaceSurface, createWorkspaceTopology, openWorkspaceSurface } from '../../src/shared/workspaceTopology';

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-workspace-topology-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('WorkspaceTopologyStore', () => {
  it('atomically extracts one parked page, preserves siblings and rejects stale extraction',async()=>{
    const store=new WorkspaceTopologyStore(papersPaths(directory));
    const sourceId='11111111-1111-4111-8111-111111111111',targetId='22222222-2222-4222-8222-222222222222';
    let source=openWorkspaceSurface(createWorkspaceTopology(),{surfaceId:'a',surfaceKey:'saved-a',projectId:'p',title:'A'});
    source=openWorkspaceSurface(source,{surfaceId:'b',surfaceKey:'saved-b',projectId:'p',title:'B'});
    const target=createWorkspaceTopology();
    await store.savePages(sourceId,source,{parked:true});await store.savePages(targetId,target,{parked:false});
    const before=await store.snapshotPair(sourceId,targetId);
    const pair={source:{workspaceId:sourceId,topology:closeWorkspaceSurface(source,'a')},target:{workspaceId:targetId,topology:openWorkspaceSurface(target,{surfaceId:'fresh-a',surfaceKey:'saved-a',projectId:'p',title:'A'})},lastWorkspaceId:before.lastWorkspaceId};
    await store.commitPair(pair,'saved-a',source);
    let records=await store.sessionSnapshots();expect(records.find(r=>r.workspaceId===sourceId)?.topology.surfaces.map(p=>p.surfaceKey)).toEqual(['saved-b']);
    expect(records.find(r=>r.workspaceId===sourceId)?.window?.parked).toBe(true);
    await expect(store.commitPair(pair,'saved-a',source)).rejects.toThrow('no longer saved');
    await store.restorePairWithIds(before,sourceId,targetId);records=await store.sessionSnapshots();
    expect(records.find(r=>r.workspaceId===sourceId)?.topology).toEqual(source);expect(records.find(r=>r.workspaceId===targetId)?.topology).toEqual(target);
    await store.closeSavedPage('saved-b');
    await expect(store.commitPair(pair,'saved-a',source)).rejects.toThrow('no longer saved');
    expect((await store.sessionSnapshots()).find(r=>r.workspaceId===sourceId)?.topology.surfaces.map(p=>p.surfaceKey)).toEqual(['saved-a']);
  });
  it('reuses durable workspace ids across commits and records last selection metadata', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const empty = createWorkspaceTopology();
    const opened = openWorkspaceSurface(empty, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    const keyA = '11111111-1111-4111-8111-111111111111';
    const keyB = '22222222-2222-4222-8222-222222222222';

    await Promise.all([
      store.commit(keyA, empty),
      store.commit(keyA, opened),
      store.commit(keyB, empty),
    ]);

    const persisted = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      schemaVersion: number; lastWorkspaceId: string;
      workspaces: Array<{ workspaceId: string; topology: typeof opened; updatedAt: string }>;
    };
    expect(persisted.schemaVersion).toBe(2);
    expect(persisted.lastWorkspaceId).toBe(keyB);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === keyA)?.topology).toEqual(opened);
    expect(persisted.workspaces.filter((entry) => entry.workspaceId === keyA)).toHaveLength(1);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === keyB)?.topology).toEqual(empty);
    const selected = await store.selectedSnapshot();
    expect(selected).toMatchObject({ workspaceId: keyB, topology: empty });
    if (selected) selected.topology.groups[0]!.groupId = 'mutated-copy';
    expect((await store.selectedSnapshot())?.topology.groups[0]?.groupId).toBe('group-main');
  });

  it('returns no selected snapshot when selection metadata is null', async () => {
    const paths = papersPaths(directory);
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({ schemaVersion: 2, lastWorkspaceId: null, workspaces: [] }));
    await expect(new WorkspaceTopologyStore(paths).selectedSnapshot()).resolves.toBeNull();
  });

  it('commits both workspace records atomically without changing startup selection', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths, () => '2026-09-02T00:00:00.000Z');
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    const source = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'sf-source', projectId: 'bp-source', title: 'Source',
    });
    const target = createWorkspaceTopology('target-group');
    await store.commit(sourceId, source);
    await store.commit(targetId, target);

    await store.commitPair({
      source: { workspaceId: sourceId, topology: createWorkspaceTopology() },
      target: { workspaceId: targetId, topology: openWorkspaceSurface(target, {
        surfaceId: 'sf-source', projectId: 'bp-source', title: 'Source',
      }) },
      lastWorkspaceId: sourceId,
    });

    const persisted = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      lastWorkspaceId: string;
      workspaces: Array<{ workspaceId: string; topology: typeof source }>;
    };
    expect(persisted.lastWorkspaceId).toBe(sourceId);
    expect(persisted.workspaces).toHaveLength(2);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === sourceId)?.topology.surfaces).toEqual([]);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === targetId)?.topology.surfaces)
      .toEqual([{ surfaceId: 'sf-source', projectId: 'bp-source', title: 'Source' }]);
  });

  it('restores a pair and removes a newly minted target workspace on compensation', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const sourceId = '33333333-3333-4333-8333-333333333333';
    const targetId = '44444444-4444-4444-8444-444444444444';
    const original = createWorkspaceTopology();
    await store.commit(sourceId, original);
    const before = await store.snapshotPair(sourceId, targetId);

    await store.commitPair({
      source: { workspaceId: sourceId, topology: openWorkspaceSurface(original, {
        surfaceId: 'sf-moved', projectId: 'bp-moved', title: 'Moved',
      }) },
      target: { workspaceId: targetId, topology: createWorkspaceTopology('target') },
      lastWorkspaceId: sourceId,
    });
    await store.restorePairWithIds(before, sourceId, targetId);

    const persisted = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      workspaces: Array<{ workspaceId: string; topology: typeof original }>;
    };
    expect(persisted.workspaces.map((entry) => entry.workspaceId)).toEqual([sourceId]);
    expect(persisted.workspaces[0]?.topology).toEqual(original);
  });

  it('serializes an ordinary commit behind a held pair save', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const sourceId = '55555555-5555-4555-8555-555555555555';
    const targetId = '66666666-6666-4666-8666-666666666666';
    const original = createWorkspaceTopology();
    await store.commit(sourceId, original);
    await store.commit(targetId, createWorkspaceTopology('target'));

    const internal = store as unknown as { store: { save(value: unknown): Promise<void> } };
    const save = internal.store.save.bind(internal.store);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const enteredSave = new Promise<void>((resolve) => { entered = resolve; });
    internal.store.save = async (value) => {
      entered();
      await held;
      return save(value);
    };

    const pair = store.commitPair({
      source: { workspaceId: sourceId, topology: original },
      target: { workspaceId: targetId, topology: createWorkspaceTopology('moved-target') },
      lastWorkspaceId: sourceId,
    });
    await enteredSave;
    let ordinaryFinished = false;
    const ordinary = store.commit(sourceId, openWorkspaceSurface(original, {
      surfaceId: 'sf-after', projectId: 'bp-after', title: 'After',
    })).then(() => { ordinaryFinished = true; });
    await Promise.resolve();
    expect(ordinaryFinished).toBe(false);
    release();
    await pair;
    await ordinary;
    expect(ordinaryFinished).toBe(true);
    const selected = await store.selectedSnapshot();
    expect(selected?.workspaceId).toBe(sourceId);
    expect(selected?.topology.surfaces).toEqual([{ surfaceId: 'sf-after', projectId: 'bp-after', title: 'After' }]);
  });

  it('keeps pair state consistent when pair save or compensation save fails', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const sourceId = '77777777-7777-4777-8777-777777777777';
    const targetId = '88888888-8888-4888-8888-888888888888';
    const source = createWorkspaceTopology();
    const target = createWorkspaceTopology('target');
    await store.commit(sourceId, source);
    await store.commit(targetId, target);
    const internal = store as unknown as { store: { save(value: unknown): Promise<void> } };
    const save = internal.store.save.bind(internal.store);
    let fail = true;
    internal.store.save = async (value) => {
      if (fail) {
        fail = false;
        throw new Error('held pair failure');
      }
      return save(value);
    };
    await expect(store.commitPair({
      source: { workspaceId: sourceId, topology: openWorkspaceSurface(source, {
        surfaceId: 'sf-moved', projectId: 'bp-moved', title: 'Moved',
      }) },
      target: { workspaceId: targetId, topology: target },
      lastWorkspaceId: sourceId,
    })).rejects.toThrow('held pair failure');

    const afterPairFailure = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      workspaces: Array<{ workspaceId: string; topology: typeof source }>;
    };
    expect(afterPairFailure.workspaces.find((entry) => entry.workspaceId === sourceId)?.topology).toEqual(source);

    const before = await store.snapshotPair(sourceId, targetId);
    await store.commitPair({
      source: { workspaceId: sourceId, topology: openWorkspaceSurface(source, {
        surfaceId: 'sf-moved', projectId: 'bp-moved', title: 'Moved',
      }) },
      target: { workspaceId: targetId, topology: target },
      lastWorkspaceId: sourceId,
    });
    fail = true;
    await expect(store.restorePairWithIds(before, sourceId, targetId)).rejects.toThrow('held pair failure');
    const afterRestoreFailure = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      workspaces: Array<{ workspaceId: string; topology: typeof source }>;
    };
    expect(afterRestoreFailure.workspaces.find((entry) => entry.workspaceId === sourceId)?.topology.surfaces)
      .toEqual([{ surfaceId: 'sf-moved', projectId: 'bp-moved', title: 'Moved' }]);
  });

  it('flush waits for queued mutations behind a held pair save', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const sourceId = '99999999-9999-4999-8999-999999999999';
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const original = createWorkspaceTopology();
    await store.commit(sourceId, original);
    await store.commit(targetId, createWorkspaceTopology('target'));

    const internal = store as unknown as { store: { save(value: unknown): Promise<void> } };
    const save = internal.store.save.bind(internal.store);
    let first = true;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const enteredSave = new Promise<void>((resolve) => { entered = resolve; });
    internal.store.save = async (value) => {
      if (first) {
        first = false;
        entered();
        await held;
      }
      return save(value);
    };

    const pair = store.commitPair({
      source: { workspaceId: sourceId, topology: original },
      target: { workspaceId: targetId, topology: createWorkspaceTopology('moved-target') },
      lastWorkspaceId: sourceId,
    });
    await enteredSave;
    const ordinary = store.commit(sourceId, openWorkspaceSurface(original, {
      surfaceId: 'sf-after-flush', projectId: 'bp-after-flush', title: 'After flush',
    }));
    let flushed = false;
    const flush = store.flush().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await pair;
    await ordinary;
    await flush;
    expect(flushed).toBe(true);
    const selected = await store.selectedSnapshot();
    expect(selected?.topology.surfaces[0]?.surfaceId).toBe('sf-after-flush');
  });

  it('quarantines structurally invalid persisted topology instead of consuming it', async () => {
    const paths = papersPaths(directory);
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({ schemaVersion: 1, workspaces: [{ workspaceKey: 'bad' }] }));

    const store = new WorkspaceTopologyStore(paths);
    await expect(store.initialize()).resolves.toBeUndefined();
    const recovered = await fs.readdir(paths.recoveryDir);
    expect(recovered.some((name) => name.includes('workspace-topologies.json') && name.endsWith('.corrupt'))).toBe(true);
  });

  it('quarantines topology that is shaped correctly but violates cross-field invariants', async () => {
    const paths = papersPaths(directory);
    const valid = openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    const invalid = { ...valid, groups: [{ ...valid.groups[0]!, surfaceIds: ['sf-a', 'sf-a'] }] };
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({
      schemaVersion: 1,
      workspaces: [{ workspaceKey: '11111111-1111-4111-8111-111111111111', topology: invalid }],
    }));
    const store = new WorkspaceTopologyStore(paths);
    await expect(store.initialize()).resolves.toBeUndefined();
    expect((await fs.readdir(paths.recoveryDir)).some((name) => name.endsWith('.corrupt'))).toBe(true);
  });

  it('migrates v1 lifetime keys to fresh explicit durable identities', async () => {
    const paths = papersPaths(directory);
    const topology = createWorkspaceTopology();
    const legacyKey = '11111111-1111-4111-8111-111111111111';
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({
      schemaVersion: 1, workspaces: [{ workspaceKey: legacyKey, topology }],
    }));
    const store = new WorkspaceTopologyStore(paths, () => '2026-09-01T00:00:00.000Z');
    await store.initialize();
    const migrated = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      schemaVersion: number; lastWorkspaceId: string; workspaces: Array<{ workspaceId: string; updatedAt: string }>;
    };
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.workspaces[0]?.workspaceId).not.toBe(legacyKey);
    expect(migrated.lastWorkspaceId).toBe(migrated.workspaces[0]?.workspaceId);
    expect(migrated.workspaces[0]?.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not invent last-workspace selection when migrating multiple legacy snapshots', async () => {
    const paths = papersPaths(directory);
    const topology = createWorkspaceTopology();
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({ schemaVersion: 1, workspaces: [
      { workspaceKey: '11111111-1111-4111-8111-111111111111', topology },
      { workspaceKey: '22222222-2222-4222-8222-222222222222', topology },
    ] }));
    await new WorkspaceTopologyStore(paths).initialize();
    const migrated = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as { lastWorkspaceId: string | null };
    expect(migrated.lastWorkspaceId).toBeNull();
  });

  it.each([
    ['duplicate durable ids', (topology: ReturnType<typeof createWorkspaceTopology>) => ({
      schemaVersion: 2, lastWorkspaceId: null, workspaces: [
        { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' },
        { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' },
      ],
    })],
    ['orphan last workspace id', (topology: ReturnType<typeof createWorkspaceTopology>) => ({
      schemaVersion: 2, lastWorkspaceId: '22222222-2222-4222-8222-222222222222', workspaces: [
        { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' },
      ],
    })],
    ['duplicate legacy keys', (topology: ReturnType<typeof createWorkspaceTopology>) => ({
      schemaVersion: 1, workspaces: [
        { workspaceKey: '11111111-1111-4111-8111-111111111111', topology },
        { workspaceKey: '11111111-1111-4111-8111-111111111111', topology },
      ],
    })],
  ])('quarantines %s instead of collapsing relationally invalid identity', async (_name, envelope) => {
    const paths = papersPaths(directory);
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify(envelope(createWorkspaceTopology())));
    await new WorkspaceTopologyStore(paths).initialize();
    expect((await fs.readdir(paths.recoveryDir)).some((name) => name.endsWith('.corrupt'))).toBe(true);
  });
});



describe('Papers unclosed pages',()=>{
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const page=(name:string,key:string)=>openWorkspaceSurface(createWorkspaceTopology(),{surfaceId:'runtime-'+key,surfaceKey:key,projectId:'same-backpack',title:name});
 const firstBounds={x:-1100,y:90,width:1050,height:750},secondBounds={x:1400,y:120,width:1000,height:750};
 it('reboots as two separate windows with stable identities and separate page topologies',async()=>{
  const store=new WorkspaceTopologyStore(papersPaths(directory));
  await store.savePages(a,page('First','page-one'),{parked:false,bounds:firstBounds});
  await store.savePages(b,page('Second','page-two'),{parked:false,bounds:secondBounds});
  const rebooted=new WorkspaceTopologyStore(papersPaths(directory));
  const windows=await rebooted.startupWindowSnapshots();
  expect(windows.map(w=>w.workspaceId)).toEqual([a,b]);
  expect(windows.map(w=>w.topology.surfaces.map(p=>p.surfaceKey))).toEqual([['page-one'],['page-two']]);
  expect(windows.map(w=>w.window?.bounds)).toEqual([firstBounds,secondBounds]);
  expect((await rebooted.sessionSnapshots())).toHaveLength(2);
 });
 it('explicit X parks a window without destroying pages; OS shutdown leaves it active',async()=>{
  const store=new WorkspaceTopologyStore(papersPaths(directory));
  await store.savePages(a,page('First','page-one'),{parked:false,bounds:firstBounds});
  await store.savePages(b,page('Second','page-two'),{parked:false,bounds:secondBounds});
  await store.savePages(b,page('Second','page-two'),{parked:true,bounds:secondBounds});
  const rebooted=new WorkspaceTopologyStore(papersPaths(directory));
  expect((await rebooted.startupWindowSnapshots()).map(w=>w.workspaceId)).toEqual([a]);
  expect((await rebooted.sessionSnapshots()).flatMap(r=>r.topology.surfaces.map(p=>p.surfaceKey))).toEqual(['page-one','page-two']);
  await rebooted.savePages(b,page('Second','page-two'),{parked:false,bounds:secondBounds});
  expect((await new WorkspaceTopologyStore(papersPaths(directory)).startupWindowSnapshots())).toHaveLength(2);
 });
 it('closing a saved page excludes it without closing other windows',async()=>{
  const store=new WorkspaceTopologyStore(papersPaths(directory));await store.savePages(a,page('First','page-one'));await store.savePages(b,page('Second','page-two'));
  await store.closeSavedPage('page-two');const windows=await new WorkspaceTopologyStore(papersPaths(directory)).startupWindowSnapshots();
  expect(windows.map(r=>r.topology.surfaces.map(p=>p.surfaceKey))).toEqual([['page-one'],[]]);
 });
 it('does not resurrect historical non-session records',async()=>{
  const store=new WorkspaceTopologyStore(papersPaths(directory));await store.commit(a,page('Historical','old'));await store.savePages(b,page('Current','current'));
  expect((await new WorkspaceTopologyStore(papersPaths(directory)).startupWindowSnapshots()).map(w=>w.workspaceId)).toEqual([b]);
 });
 it('compensates failed page parking and close saves, retaining every previously unclosed page',async()=>{
  const store=new WorkspaceTopologyStore(papersPaths(directory));await store.savePages(a,page('First','one'),{parked:false,bounds:firstBounds});await store.savePages(b,page('Second','two'));
  const internal=store as unknown as {store:{save(value:unknown):Promise<void>}};const save=internal.store.save.bind(internal.store);internal.store.save=async()=>{throw Error('disk unavailable');};
  await expect(store.savePages(a,page('First','one'),{parked:true,bounds:firstBounds})).rejects.toThrow('disk unavailable');
  expect((await store.startupWindowSnapshots()).map(w=>w.workspaceId)).toContain(a);
  await expect(store.closeSavedPage('two')).rejects.toThrow('disk unavailable');expect((await store.sessionSnapshots()).flatMap(r=>r.topology.surfaces)).toHaveLength(2);
  internal.store.save=save;await store.flush();expect((await new WorkspaceTopologyStore(papersPaths(directory)).sessionSnapshots()).flatMap(r=>r.topology.surfaces)).toHaveLength(2);
 });
});
