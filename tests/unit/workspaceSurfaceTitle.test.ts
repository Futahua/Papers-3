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
});
