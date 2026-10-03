import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite emits `<script type="module" crossorigin ...>` on every build. That
 * attribute forces a CORS-mode fetch, and Papers registers the papers-backpack:
 * scheme with `corsEnabled: false` — so the bundle can fail to load with no
 * visible symptom beyond a blank surface.
 *
 * The working As-you-go Backpack emits a plain `<script type="module" src=...>`,
 * which is the shape this scheme actually serves. Same-origin assets need no
 * CORS negotiation, so removing the attribute costs nothing.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'papers-backpack-no-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(=(["'])[^"']*\2)?/g, '');
    },
  };
}

// Built into public/ because Papers displays only static files from there, and
// the page is loaded from a custom scheme root — so asset URLs must be relative
// rather than absolute.
export default defineConfig({
  plugins: [react(), stripCrossorigin()],
  base: './',
  build: {
    outDir: 'public',
    emptyOutDir: true,
    assetsDir: 'assets',
    // One entry chunk keeps the served surface to a single script, matching what
    // this scheme is known to serve, and keeps the candidate diff legible.
    modulePreload: false,
  },
  test: { environment: 'jsdom' },
});
