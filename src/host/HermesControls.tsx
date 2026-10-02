import React from 'react';

import type { HermesPlacement } from './bridge';

/**
 * One compact control remains for the detached Hermes window.
 *
 * The retired Papers-side Hermes panel/sidebar entry point is intentionally
 * absent. State still follows the real surface placement so the remaining
 * window control stays honest if legacy Hermes machinery changes placement.
 */
export function HermesControls(props: {
  placement: HermesPlacement;
  busy: boolean;
  onToggleWindow: () => void;
}): React.JSX.Element {
  const detached = props.placement === 'detached';

  return (
    <div className="hermes-controls" role="group" aria-label="Hermes placement">
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
