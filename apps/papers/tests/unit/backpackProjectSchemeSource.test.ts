import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../src/main/security/backpackProjectScheme.ts', import.meta.url),
  'utf8',
);

describe('Backpack preview scheme policy', () => {
  it('allows renderer-created blob image previews such as extracted Revit thumbnails', () => {
    expect(source).toContain('img-src ${origin} ${previewOrigin} data: blob:');
  });

  it('allows Chromium extension handling on the streamed preview scheme for the built-in PDF viewer', () => {
    expect(source).toMatch(
      /scheme: FILE_PREVIEW_SCHEME,[\s\S]*?stream: true,[\s\S]*?allowExtensions: true,/,
    );
  });
});
