import React, { useEffect } from 'react';

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
  onDismiss: () => void;
}): React.JSX.Element {
  const { url, surfaceId, onDismiss } = props;

  useEffect(() => {
    if (!surfaceId) return undefined;
    void host().backpackProject.showSurface(surfaceId, url);
    const unsubscribe = host().events.onBackpackProjectCloseRequest((payload) => {
      // Ignore a close aimed at some other surface in this window.
      if (payload?.surfaceId === surfaceId) onDismiss();
    });
    return () => {
      unsubscribe();
      void host().backpackProject.hideSurface(surfaceId);
    };
  }, [onDismiss, surfaceId, url]);

  return <section className="backpack-project-frame" aria-label="Backpack project" />;
}
