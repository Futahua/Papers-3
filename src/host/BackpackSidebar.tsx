import React from 'react';
import type { BackpacksList } from './bridge';

export function BackpackSidebar({ list, activeId, onEnter, onMouseEnter, onMouseLeave, onReload, reloading, reloadError }: {
  onReload?:()=>void;
  reloading?:boolean;
  reloadError?:string;
  list: BackpacksList;
  activeId: string | null;
  onEnter: (id: string, newTab?: boolean) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}): React.JSX.Element {
  const backpacks = list.backpacks.filter((backpack) => !backpack.archived);
  return <nav id="backpack-sidebar" className="backpack-sidebar" aria-label="Choose Backpack"
    onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <p className="eyebrow">Backpacks</p>
    <div className="backpack-sidebar-list">
      {backpacks.map((backpack) => <button
        key={backpack.id}
        type="button"
        aria-current={backpack.id === activeId ? 'page' : undefined}
        onClick={() => onEnter(backpack.id)}
        onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onEnter(backpack.id, true); } }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            onEnter(backpack.id, true);
          }
        }}
      >{backpack.name}</button>)}
      {backpacks.length === 0 && <p className="backpack-sidebar-empty">No Backpacks yet.</p>}
    </div>
    {onReload&&<button type="button" className="secondary" onClick={onReload} disabled={reloading}>{reloading?'Saving and reloading…':'↻ Reload Papers'}</button>}
    {reloadError&&<p role="alert">{reloadError}</p>}
  </nav>;
}
