import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../resources/native/windows-preview-host.cs', import.meta.url),
  'utf8',
);

describe('Windows preview host source', () => {
  it('binds the preview handler window once and uses SetRect-only updates after startup', () => {
    expect(source.match(/handler\.SetWindow\(/g) ?? []).toHaveLength(1);
    expect(source).toContain('place(x, y, width, height, true);');
    expect(source).toContain('place(mx,my,mw,mh, false);');
  });

  it('contains command-dispatch exceptions inside the helper instead of surfacing a WinForms crash dialog', () => {
    expect(source).toMatch(/host\.BeginInvoke\(new Action\(\(\) => \{\s*try \{/);
    expect(source).toContain('WriteError(error.GetType().Name + ": " + error.Message);');
    expect(source).toContain('try { host.Close(); } catch {}');
  });
});