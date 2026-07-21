import React from 'react';

import type { HermesPlacement } from './bridge';

/**
 * Two compact SVG-symbol controls for the one global Hermes experience:
 *
 * - sidebar toggle — docks / hides the real Hermes Desktop as a Papers sidebar;
 * - window toggle — detaches / hides the same Hermes as a floating window.
 *
 * Docked and detached are two placements of the SAME Hermes, never two Hermes
 * products. Each control shows its active/inactive state, carries a tooltip and
 * an accessible name, and toggles on repeated clicks. State is driven by the
 * real surface placement so the symbols stay honest after Hermes closes,
 * crashes, docks or detaches by any path.
 */
export function HermesControls(props: {
  placement: HermesPlacement;
  busy: boolean;
  onToggleDock: () => void;
  onToggleWindow: () => void;
}): React.JSX.Element {
  const docked = props.placement === 'docked';
  const detached = props.placement === 'detached';

  return (
    <div className="hermes-controls" role="group" aria-label="Hermes placement">
      <button
        type="button"
        className={`hermes-toggle${docked ? ' active' : ''}${props.busy ? ' busy' : ''}`}
        aria-pressed={docked}
        aria-label={docked ? 'Hide the Hermes sidebar' : 'Dock Hermes as a sidebar'}
        title={docked ? 'Hide the Hermes sidebar' : 'Dock Hermes as a sidebar'}
        onClick={props.onToggleDock}
      >
        <SidebarSymbol active={docked} />
      </button>
      <button
        type="button"
        className={`hermes-toggle${detached ? ' active' : ''}${props.busy ? ' busy' : ''}`}
        aria-pressed={detached}
        aria-label={detached ? 'Hide the Hermes window' : 'Open Hermes as a window'}
        title={detached ? 'Hide the Hermes window' : 'Open Hermes as a window'}
        onClick={props.onToggleWindow}
      >
        <WindowSymbol active={detached} />
      </button>
    </div>
  );
}

/** A panel with a highlighted right-hand column — the docked sidebar idea. */
function SidebarSymbol({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect
        x="12"
        y="4"
        width="5"
        height="12"
        rx="1.5"
        fill="currentColor"
        opacity={active ? 0.9 : 0.28}
      />
    </svg>
  );
}

/** A free-floating window with a title bar — the detached window idea. */
function WindowSymbol({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <rect
        x="4.5"
        y="5.5"
        width="13"
        height="11"
        rx="2"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.14 : 0}
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <line x1="4.5" y1="8.5" x2="17.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="3.5" width="9" height="2.4" rx="1.2" fill="currentColor" opacity={active ? 0.9 : 0.32} />
    </svg>
  );
}
