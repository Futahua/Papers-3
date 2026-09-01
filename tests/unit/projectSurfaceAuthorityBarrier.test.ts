import { describe, expect, it } from 'vitest';

import { createProjectSurfaceAuthorityBarrier } from '../../src/main/backpacks/projectSurfaceAuthorityBarrier';

describe('project surface authority barrier', () => {
  it('queues staged sender authority until adoption', async () => {
    const barrier = createProjectSurfaceAuthorityBarrier();
    const staged = barrier.stage(41);
    let released = false;
    const waiting = barrier.wait(41).then(() => { released = true; });

    await Promise.resolve();
    expect(released).toBe(false);
    expect(barrier.isPending(41)).toBe(true);

    staged.adopt();
    await waiting;
    expect(released).toBe(true);
    expect(barrier.isPending(41)).toBe(false);
    await expect(barrier.wait(41)).resolves.toBeUndefined();
  });

  it('rejects queued authority when staging is discarded', async () => {
    const barrier = createProjectSurfaceAuthorityBarrier();
    const staged = barrier.stage(42);
    const waiting = barrier.wait(42);

    staged.discard();

    await expect(waiting).rejects.toThrow(/discarded/);
    expect(barrier.isPending(42)).toBe(false);
    await expect(barrier.wait(42)).rejects.toThrow(/discarded/);
  });

  it('does not let a duplicate stage or second terminal action change state', async () => {
    const barrier = createProjectSurfaceAuthorityBarrier();
    const staged = barrier.stage(43);
    expect(() => barrier.stage(43)).toThrow(/already staged/);
    staged.adopt();
    staged.discard();
    await expect(barrier.wait(43)).resolves.toBeUndefined();
    barrier.forget(43);
    await expect(barrier.wait(43)).resolves.toBeUndefined();
  });
});
