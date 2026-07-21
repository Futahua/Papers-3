import React, { useEffect, useRef, useState } from 'react';

import { host, type HermesSurfaceStatus } from './bridge';

export function HermesDock(props: { onClose: () => void }): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<HermesSurfaceStatus>({ state: 'starting' });
  const [popoutError, setPopoutError] = useState<string | null>(null);

  const surfaceBounds = (): { x: number; y: number; width: number; height: number } => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return {
      x: Math.round(rect?.x ?? 0),
      y: Math.round(rect?.y ?? 48),
      width: Math.round(rect?.width ?? 480),
      height: Math.round(rect?.height ?? 640),
    };
  };

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const report = (): void => {
      void host().hermes.setBounds(surfaceBounds());
    };
    void host().hermes.show(surfaceBounds()).then(setStatus);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      void host().hermes.hide();
    };
  }, []);

  return (
    <aside className="hermes-dock" aria-label="Hermes">
      <header>
        <span className="hermes-mark">☤</span>
        <strong>Hermes</strong>
        <span className="spacer" />
        <button
          className="ghost"
          onClick={() => {
            setPopoutError(null);
            void host().hermes.openDesktop().catch((error) => setPopoutError(String(error)));
          }}
        >
          Pop out
        </button>
        <button className="ghost" onClick={props.onClose}>Close</button>
      </header>
      {popoutError && <div className="hermes-notice error">{popoutError}</div>}
      <div className="hermes-surface" ref={surfaceRef}>
        {status.state === 'starting' && <div className="hermes-notice">Starting the existing Hermes interface…</div>}
        {status.state === 'error' && (
          <div className="hermes-notice error">
            <strong>Hermes could not open.</strong>
            <span>{status.detail}</span>
            <button onClick={() => void host().hermes.show(surfaceBounds()).then(setStatus)}>
              Try again
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
