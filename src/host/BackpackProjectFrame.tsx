import React, { useLayoutEffect, useRef } from 'react';

import { host } from './bridge';

/**
 * The project is composed by main as a transparent WebContentsView. Keeping a
 * renderer-owned placeholder preserves the host layout while avoiding the
 * opaque OOPIF surface Chromium creates for a cross-origin iframe.
 */
export function BackpackProjectFrame(props: {
  url: string;
  /** The logical surface this frame shows. Main verifies it; it is never
   * inferred from "the window's only surface". */
  surfaceId: string | null;
  visible?: boolean;
  occluded?: boolean;
}): React.JSX.Element {
  const { url, surfaceId, visible = true, occluded = false } = props;
  const frameRef = useRef<HTMLElement | null>(null);
  const occludedRef = useRef(occluded);
  occludedRef.current = occluded;
  const syncBoundsRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!surfaceId || !visible) return undefined;
    const frame = frameRef.current;
    if (!frame) return undefined;
    const syncBounds = (): void => {
      const rect = frame.getBoundingClientRect();
      void host().backpackProject.setSurfaceBounds(surfaceId, {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: occludedRef.current ? 0 : Math.max(0, Math.round(rect.width)),
        height: occludedRef.current ? 0 : Math.max(0, Math.round(rect.height)),
      });
    };
    syncBoundsRef.current = syncBounds;
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(frame);
    void host().backpackProject.showSurface(surfaceId, url).then(syncBounds);
    return () => {
      observer.disconnect();
      syncBoundsRef.current = null;
      void host().backpackProject.hideSurface(surfaceId);
    };
  }, [surfaceId, url, visible]);

  useLayoutEffect(() => { syncBoundsRef.current?.(); }, [occluded]);

  return <section ref={frameRef} className="backpack-project-frame" aria-label="Backpack project" />;
}
