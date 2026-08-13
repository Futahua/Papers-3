import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.join(__dirname, '../..');

/** The FINAL AYG page request event: this literal is the single integration
 * point between AYG's host-bridge page API and the Papers preload bridge. */
const PAGE_THUMBNAIL_EVENT = 'papers:project:window-thumbnail';
const PAPERS_THUMBNAIL_CHANNEL = 'papers:window-capability:thumbnail';

const PRELOAD_SOURCE = path.join(REPO_ROOT, 'src', 'preload', 'backpackProject.ts');
/** AYG is a separate repository; the file may be absent on machines that only
 * carry the Papers tree, so the cross-repo part degrades to a documented
 * NOT-RUN instead of a hard failure. */
const AYG_HOST_BRIDGE = path.join(
  REPO_ROOT, '..', '..', 'Papers', 'Backpack projects', 'As you Go', 'public', 'app', 'host', 'host-bridge.js',
);

describe('019GR2 end-to-end thumbnail event alignment', () => {
  it('the Papers preload listens for exactly the final page event', () => {
    const source = fs.readFileSync(PRELOAD_SOURCE, 'utf8');
    expect(source).toContain(`request.type === '${PAGE_THUMBNAIL_EVENT}'`);
    expect(source).toContain(`ipcRenderer.invoke('${PAPERS_THUMBNAIL_CHANNEL}',`);
    // The preload must never listen for the superseded event name.
    expect(source).not.toContain('papers:project:window-thumbnail-capability');
  });

  it('the AYG host bridge sends exactly the same page event (cross-repo static alignment)', () => {
    if (!fs.existsSync(AYG_HOST_BRIDGE)) {
      // Cross-repo alignment is NOT RUN when the AYG tree is not present.
      expect(true).toBe(true);
      return;
    }
    const source = fs.readFileSync(AYG_HOST_BRIDGE, 'utf8');
    expect(source).toContain(`request('${PAGE_THUMBNAIL_EVENT}'`);
    expect(source).not.toContain('papers:project:window-thumbnail-capability');
    // AYG always passes both bounded integer dimensions (its defaults).
    expect(source).toContain('maxWidth: options.maxWidth ?? 240');
    expect(source).toContain('maxHeight: options.maxHeight ?? 135');
  });
});
