/**
 * Entry point. Deliberately empty of product: it proves the toolchain builds and
 * mounts, and nothing else. The interface is the work to be done here.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('the Delegate Wave Backpack has no mount point');
createRoot(root).render(<StrictMode><div id="app" /></StrictMode>);
