import { describe, expect, it, vi } from 'vitest';

import { HermesSurface, type HermesPlacement } from '../../src/main/hermes/hermesSurface';

type SurfaceInternals = {
  placement: HermesPlacement;
  ensureDesktop: () => Promise<void>;
  controlHermes: (command: Record<string, unknown>) => Promise<{ ok: boolean } | null>;
};

function createSurface() {
  const owner = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 200, width: 1200, height: 800 }),
  };
  const surface = new HermesSurface(() => owner as never);
  const internals = surface as unknown as SurfaceInternals;
  internals.ensureDesktop = vi.fn(async () => {});
  return { surface, internals };
}

describe('HermesSurface control acknowledgements', () => {
  it('does not commit docked placement when setBounds is rejected', async () => {
    const { surface, internals } = createSurface();
    internals.controlHermes = vi.fn(async () => ({ ok: false }));

    const state = await surface.dock({ x: 800, y: 0, width: 400, height: 800 });

    expect(state).toMatchObject({ placement: 'closed', status: 'error' });
    expect(state.detail).toContain('window bounds');
  });

  it('does not commit detached placement when focus has no valid reply', async () => {
    const { surface, internals } = createSurface();
    internals.controlHermes = vi.fn(async () => null);

    const state = await surface.showDetached();

    expect(state).toMatchObject({ placement: 'closed', status: 'error' });
    expect(state.detail).toContain('focus');
  });

  it('keeps docked placement when minimize is rejected', async () => {
    const { surface, internals } = createSurface();
    internals.placement = 'docked';
    internals.controlHermes = vi.fn(async () => ({ ok: false }));

    await expect(surface.hideDock()).rejects.toThrow('minimize');
    expect(surface.state.placement).toBe('docked');
  });

  it('keeps detached placement when minimize has no valid reply', async () => {
    const { surface, internals } = createSurface();
    internals.placement = 'detached';
    internals.controlHermes = vi.fn(async () => null);

    await expect(surface.hideDetached()).rejects.toThrow('minimize');
    expect(surface.state.placement).toBe('detached');
  });
});
