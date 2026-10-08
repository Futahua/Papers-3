import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PendingPermissionPrompt, ShelfContribution } from '@shared/types';
import { host, type BackpacksList, type CatalogInfo, type SaveStatusPayload } from './bridge';
import { BackpackHome } from './BackpackHome';
import { CanvasFrame } from './CanvasFrame';
import { PermissionPromptModal, PermissionsPanel } from './Modals';

/** Opt-in fixture surface for program, file and capability-broker tests. */
export function FixtureApp(): React.JSX.Element {
 const [backpacks,setBackpacks]=useState<BackpacksList>({backpacks:[],activeBackpackId:null});
 const [catalog,setCatalog]=useState<CatalogInfo>({programs:[],issues:[],statuses:[],activeProgramId:null});
 const [shelf,setShelf]=useState<ShelfContribution[]>([]);
 const [saveStatus,setSaveStatus]=useState<SaveStatusPayload>({status:'idle',detail:null});
 const [prompts,setPrompts]=useState<PendingPermissionPrompt[]>([]);
 const [permissionsOpen,setPermissionsOpen]=useState(false);
 const refresh=useCallback(async()=>{setBackpacks(await host().backpacks.list());setCatalog(await host().programs.catalog());},[]);
 useEffect(()=>{void refresh();const b=host();const off=[b.events.onBackpacksChanged(setBackpacks),b.events.onProgramStatus(()=>void refresh()),b.events.onShelfChanged(setShelf),b.events.onSaveStatus(setSaveStatus),b.events.onPermissionPrompt(p=>setPrompts(old=>[...old,p]))];return()=>off.forEach(f=>f());},[refresh]);
 useEffect(()=>{void host().layout.setOverlayActive(prompts.length>0||permissionsOpen);},[prompts.length,permissionsOpen]);
 useEffect(()=>{void host().backpacks.startupRestore().then(async id=>{if(id){await host().backpacks.enter(id);await refresh();}}).catch(()=>undefined);},[refresh]);
 const backpack=useMemo(()=>backpacks.backpacks.find(b=>b.id===backpacks.activeBackpackId)||null,[backpacks]);
 return <div className="fixture-app">{backpack?<CanvasFrame backpack={backpack} catalog={catalog} shelf={shelf} saveStatus={saveStatus} onCatalogChanged={refresh} onLeave={async()=>{await host().backpacks.leave();await refresh();}} onOpenPermissions={()=>setPermissionsOpen(true)}/>:<BackpackHome list={backpacks} onChanged={refresh} onEntered={refresh}/>}{permissionsOpen&&<PermissionsPanel onClose={()=>setPermissionsOpen(false)}/ >}{prompts[0]&&<PermissionPromptModal prompt={prompts[0]} onDecided={id=>setPrompts(old=>old.filter(p=>p.promptId!==id))}/>}</div>;
}
