import React from 'react';
import type { BackpacksList } from './bridge';

export function BackpackSidebar({ list, activeId, onEnter }: {
  list: BackpacksList;
  activeId: string | null;
  onEnter: (id: string, newTab?: boolean) => void;
}): React.JSX.Element {
  const backpacks = list.backpacks.filter((backpack) => !backpack.archived);
  return <nav className="backpack-sidebar" aria-label="Choose Backpack">
    <p className="eyebrow">Backpacks</p>
    <div id="backpack-sidebar" className="backpack-sidebar-list" role="listbox" aria-label="Choose Backpack">
      {backpacks.map((backpack) => <button
        key={backpack.id}
        type="button"
        aria-selected={backpack.id === activeId}
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
  </nav>;
}
