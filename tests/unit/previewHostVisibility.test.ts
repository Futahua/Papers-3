import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('hosted preview surface visibility', () => {
  it('persists hidden surface state before HTML, PDF, or Windows preview sessions open', async () => {
    for (const relative of [
      '../../src/main/backpacks/htmlPreviewHostBridge.ts',
      '../../src/main/backpacks/pdfPreviewHostBridge.ts',
      '../../src/main/backpacks/windowsPreviewHandlerBridge.ts',
      '../../src/main/backpacks/webBrowserHostBridge.ts',
    ]) {
      const source = await readFile(new URL(relative, import.meta.url), 'utf8');
      expect(source).toContain('ownerVisibility');
      expect(source).toContain('setOwnerVisible');
    }
  });

  it('requires both the owning surface and the preview pane to be visible for web content', async () => {
    const source = await readFile(new URL('../../src/main/backpacks/webBrowserHostBridge.ts', import.meta.url), 'utf8');
    expect(source).toContain('ownerVisibility.get(session.ownerKey) === true && session.previewVisible');
    expect(source).toContain('setPreviewVisible(ownerKey, sessionId, visible)');
    expect(source).toContain('session.previewVisible = visible');
  });
});
