import React, { useEffect } from 'react';

import { host } from './bridge';

/**
 * The project is composed by main as a transparent WebContentsView. Keeping a
 * renderer-owned placeholder preserves the host layout while avoiding the
 * opaque OOPIF surface Chromium creates for a cross-origin iframe.
 */
export function BackpackProjectFrame(props: { url: string; onDismiss: () => void }): React.JSX.Element {
  const { url, onDismiss } = props;

  useEffect(() => {
    void host().backpackProject.showSurface(url);
    const unsubscribe = host().events.onBackpackProjectCloseRequest(onDismiss);
    return () => {
      unsubscribe();
      void host().backpackProject.hideSurface();
    };
  }, [onDismiss, url]);

  return <section className="backpack-project-frame" aria-label="Backpack project" />;
}
