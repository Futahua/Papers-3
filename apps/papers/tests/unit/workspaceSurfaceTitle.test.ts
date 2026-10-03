import { describe, expect, it } from 'vitest';

import {
  MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS,
  normalizeWorkspaceSurfaceTitle,
} from '../../src/shared/workspaceSurfaceTitle';

describe('workspace surface titles', () => {
  it('keeps ordinary Unicode and uses the fallback for an empty document title', () => {
    expect(normalizeWorkspaceSurfaceTitle('  Hồ sơ 📦  ', 'As you Go')).toBe('Hồ sơ 📦');
    expect(normalizeWorkspaceSurfaceTitle('   ', 'As you Go')).toBe('As you Go');
  });

  it('bounds hostile titles without splitting a surrogate pair', () => {
    const title = `${'x'.repeat(MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS)}😀`;
    const bounded = normalizeWorkspaceSurfaceTitle(title, 'fallback');
    expect(Array.from(bounded)).toHaveLength(MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS);
    expect(bounded.endsWith('…')).toBe(true);
    expect(bounded.includes('\uD800')).toBe(false);
  });

  it('does not cut grapheme clusters at the safety boundary', () => {
    const prefix = 'x'.repeat(MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS - 2);
    const bounded = normalizeWorkspaceSurfaceTitle(`${prefix}👩🏽‍💻Z`, 'fallback');
    expect(bounded.endsWith('…')).toBe(true);
    expect(bounded).not.toContain('👩');

    const combining = normalizeWorkspaceSurfaceTitle(
      `${'x'.repeat(MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS - 2)}e\u0301Z`,
      'fallback',
    );
    expect(combining.endsWith('…')).toBe(true);
    expect(combining).not.toMatch(/e$/u);
  });
});
