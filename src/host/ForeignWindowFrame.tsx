import React, { useLayoutEffect, useRef } from 'react';

import { host } from './bridge';

/** Renderer-side geometry anchor for a top-level adopted application window.
 * The native window remains owned by its application; this element contributes
 * only the pane rectangle and forwards it to the main-process controller. */
export function ForeignWindowFrame(props: { surfaceId: string; visible?: boolean }): React.JSX.Element {
  const { surfaceId, visible = true } = props;
  const frameRef = useRef<HTMLElement | null>(null);
  const syncRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const frame = frameRef.current;
    if (!frame) return undefined;
    const sync = (): void => {
      const rect = frame.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void host().foreignWindow.setBounds(surfaceId, {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      }).catch(() => undefined);
    };
    syncRef.current = sync;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      syncRef.current = null;
    };
  }, [surfaceId, visible]);

  return <section ref={frameRef} className="foreign-window-frame" aria-label="Foreign application window" />;
}
