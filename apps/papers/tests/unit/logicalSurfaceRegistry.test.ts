import { describe, expect, it } from 'vitest';

import { createLogicalSurfaceRegistry } from '../../src/main/windows/logicalSurfaceRegistry';

/** Deterministic ids, so the invariants are readable rather than inferred. */
function registry() {
  let n = 0;
  return createLogicalSurfaceRegistry(() => `sf-${++n}`);
}

const board = { windowId: 1, projectId: 'bp-a', kind: 'project' as const };

describe('logical surface registry', () => {
  it('gives each surface its own opaque id', () => {
    const surfaces = registry();
    const first = surfaces.create(board);
    const second = surfaces.create(board);

    expect(first.surfaceId).not.toBe(second.surfaceId);
    expect(surfaces.size).toBe(2);
  });

  it('lets two surfaces show the same project', () => {
    const surfaces = registry();
    const inWindowOne = surfaces.create({ ...board, windowId: 1 });
    const inWindowTwo = surfaces.create({ ...board, windowId: 2 });

    // Same board open in two windows is the whole feature, not a conflict.
    expect(inWindowOne.projectId).toBe(inWindowTwo.projectId);
    expect(surfaces.listForWindow(1).map((s) => s.surfaceId)).toEqual([inWindowOne.surfaceId]);
    expect(surfaces.listForWindow(2).map((s) => s.surfaceId)).toEqual([inWindowTwo.surfaceId]);
  });

  it('keeps its identity when it moves between windows', () => {
    const surfaces = registry();
    const surface = surfaces.create({ ...board, windowId: 1 });

    expect(surfaces.moveToWindow(surface.surfaceId, 2)).toBe(true);

    // Moving a tab is not opening a new one: anything holding this id still
    // means this tab.
    const moved = surfaces.get(surface.surfaceId)!;
    expect(moved.surfaceId).toBe(surface.surfaceId);
    expect(moved.windowId).toBe(2);
    expect(surfaces.listForWindow(1)).toEqual([]);
  });

  it('survives its renderer dying, because identity is not the transport', () => {
    const surfaces = registry();
    const surface = surfaces.create(board);

    // A WebContentsView crash or reload changes nothing here. There is simply
    // an interval with no sender bound, during which the tab still exists --
    // the interval a sender-keyed registry could not describe truthfully.
    expect(surfaces.get(surface.surfaceId)?.state).toBe('live');
    expect(surfaces.isLiveIn(surface.surfaceId, 1)).toBe(true);
  });

  it('never issues a retired id again', () => {
    // An id source that repeats itself once before moving on: the registry
    // must skip the spent id rather than hand it out a second time.
    const sequence = ['sf-1', 'sf-1', 'sf-2'];
    let index = 0;
    const surfaces = createLogicalSurfaceRegistry(() => sequence[Math.min(index++, sequence.length - 1)]!);

    const first = surfaces.create(board);
    expect(first.surfaceId).toBe('sf-1');
    surfaces.retire(first.surfaceId);

    // A stale client holding 'sf-1' must never reach this later surface.
    const later = surfaces.create(board);
    expect(later.surfaceId).toBe('sf-2');
  });

  it('refuses loudly rather than hanging when no unused id can be produced', () => {
    // Retrying forever against an exhausted source would be a hang, which is a
    // worse failure than an error.
    const surfaces = createLogicalSurfaceRegistry(() => 'sf-same');
    surfaces.create(board);
    expect(() => surfaces.create(board)).toThrow(/unused surface id/);
  });

  it('fails closed for every command targeting a retired surface', () => {
    const surfaces = registry();
    const surface = surfaces.create(board);
    surfaces.retire(surface.surfaceId);

    expect(surfaces.get(surface.surfaceId)).toBeNull();
    expect(surfaces.isLiveIn(surface.surfaceId, 1)).toBe(false);
    expect(surfaces.moveToWindow(surface.surfaceId, 2)).toBe(false);
    expect(surfaces.retire(surface.surfaceId)).toBe(false);
  });

  it('requires the window to agree, not merely that the surface exists', () => {
    const surfaces = registry();
    const surface = surfaces.create({ ...board, windowId: 1 });

    // {windowId, surfaceId} must agree with current state; a target naming the
    // wrong window is refused rather than resolved to the nearest match.
    expect(surfaces.isLiveIn(surface.surfaceId, 1)).toBe(true);
    expect(surfaces.isLiveIn(surface.surfaceId, 2)).toBe(false);
    expect(surfaces.isLiveIn('sf-never-existed', 1)).toBe(false);
  });

  it('retires a closing window own surfaces and leaves the other window alone', () => {
    const surfaces = registry();
    const one = surfaces.create({ ...board, windowId: 1 });
    const two = surfaces.create({ ...board, windowId: 1 });
    const other = surfaces.create({ ...board, windowId: 2 });

    expect(surfaces.retireWindow(1).sort()).toEqual([one.surfaceId, two.surfaceId].sort());
    expect(surfaces.get(other.surfaceId)?.surfaceId).toBe(other.surfaceId);
    expect(surfaces.size).toBe(1);
  });

  it('retires every surface of a project that became unavailable, in any window', () => {
    const surfaces = registry();
    const a1 = surfaces.create({ windowId: 1, projectId: 'bp-a', kind: 'project' });
    const a2 = surfaces.create({ windowId: 2, projectId: 'bp-a', kind: 'project' });
    const b1 = surfaces.create({ windowId: 1, projectId: 'bp-b', kind: 'project' });

    // Archiving or removing a Backpack is the case where reaching across
    // windows is correct: the thing itself is gone.
    expect(surfaces.retireProject('bp-a').sort()).toEqual([a1.surfaceId, a2.surfaceId].sort());
    expect(surfaces.get(b1.surfaceId)).not.toBeNull();
  });

  it('projects only what a control client may see', () => {
    const surfaces = registry();
    surfaces.create({ windowId: 1, projectId: 'bp-a', kind: 'project' });

    // No sender ids, no URLs, no roots. Sender ids are a process detail, and
    // exposing them would invite clients to depend on the transport rather
    // than the logical model.
    expect(surfaces.project()).toEqual([
      { surfaceId: 'sf-1', windowId: 1, projectId: 'bp-a', kind: 'project' },
    ]);
  });

  it('projects live surfaces only', () => {
    const surfaces = registry();
    const kept = surfaces.create(board);
    const gone = surfaces.create(board);
    surfaces.retire(gone.surfaceId);

    expect(surfaces.project().map((s) => s.surfaceId)).toEqual([kept.surfaceId]);
  });

  it('hands back copies, so a caller cannot rewrite the registry through one', () => {
    const surfaces = registry();
    const created = surfaces.create(board);
    created.windowId = 99;
    created.projectId = 'bp-tampered';

    const read = surfaces.get(created.surfaceId)!;
    read.windowId = 98;

    const actual = surfaces.get(created.surfaceId)!;
    expect(actual.windowId).toBe(1);
    expect(actual.projectId).toBe('bp-a');
  });
});
