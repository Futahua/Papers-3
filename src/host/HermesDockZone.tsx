import React, { useEffect, useRef, useState } from 'react';

import type { HermesPlacement } from './bridge';

/**
 * Direct-manipulation docking for the one Hermes experience, using a
 * Papers-drawn grab handle and snap zone (the handoff-sanctioned equivalent to
 * OS free-drag, which Papers cannot intercept on a foreign window):
 *
 * - When docked, a grip handle sits on the sidebar's inner edge. Dragging it
 *   away from the edge past a threshold detaches Hermes into a window.
 * - When detached, a dock target appears on Papers' right edge. Dragging onto
 *   it (or activating it) docks the same Hermes back as the sidebar.
 *
 * Neither gesture creates a second Hermes UI or loses the session — they only
 * change the placement of the same real Hermes Desktop window.
 */
export function HermesDockZone(props: {
  placement: HermesPlacement;
  dockWidth: number;
  onDetach: () => void;
  onDock: () => void;
}): React.JSX.Element | null {
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const startX = useRef(0);

  // Grip on the docked sidebar's inner edge → drag inward to detach.
  useEffect(() => {
    if (!dragging) return;
    const DETACH_THRESHOLD = 70;
    const onMove = (e: MouseEvent): void => {
      setArmed(Math.abs(e.clientX - startX.current) > DETACH_THRESHOLD);
    };
    const onUp = (e: MouseEvent): void => {
      setDragging(false);
      if (Math.abs(e.clientX - startX.current) > DETACH_THRESHOLD) props.onDetach();
      setArmed(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, props]);

  if (props.placement === 'docked') {
    return (
      <button
        type="button"
        className={`hermes-grip${armed ? ' armed' : ''}`}
        style={{ right: props.dockWidth }}
        aria-label="Drag to detach Hermes into a window"
        title="Drag inward to detach Hermes into a window"
        onMouseDown={(e) => {
          startX.current = e.clientX;
          setDragging(true);
        }}
      >
        <span className="grip-dots" aria-hidden="true" />
      </button>
    );
  }

  if (props.placement === 'detached') {
    return (
      <DockTarget dockWidth={props.dockWidth} onDock={props.onDock} />
    );
  }

  return null;
}

/**
 * Right-edge dock target shown while Hermes is a detached window. It offers a
 * clear place to bring Hermes back: dragging over it highlights the zone, and
 * releasing (or clicking) docks Hermes back as the sidebar.
 */
function DockTarget(props: { dockWidth: number; onDock: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      className={`hermes-dock-target${hover ? ' hover' : ''}`}
      style={{ width: props.dockWidth }}
      aria-label="Dock Hermes back as the sidebar"
      title="Dock Hermes back as the sidebar"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseUp={() => props.onDock()}
      onClick={() => props.onDock()}
    >
      <span className="dock-target-inner">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="4.5" width="6.5" height="15" rx="1.5" fill="currentColor" opacity="0.85" />
        </svg>
        <span>Dock Hermes here</span>
      </span>
    </button>
  );
}
