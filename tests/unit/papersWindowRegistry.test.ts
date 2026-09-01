import { describe, expect, it } from 'vitest';

import { createPapersWindowRegistry } from '../../src/main/windows/papersWindowRegistry';

/** Stands in for what a window really owns: its native window, host view and
 * project runtime. The registry never inspects it. */
type Owned = { label: string };
const owned = (label: string): Owned => ({ label });

describe('Papers window registry', () => {
  it('resolves a host sender to its own window', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.add(2, owned('w2'));
    windows.setHostSender(1, 11);
    windows.setHostSender(2, 21);

    expect(windows.windowForSender(11)).toBe(1);
    expect(windows.windowForSender(21)).toBe(2);
  });

  it('refuses an unknown sender rather than attributing it to the only window', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.setHostSender(1, 11);

    // The single-window stub this replaces would have answered "window 1".
    expect(windows.windowForSender(999)).toBeNull();
  });

  it('closing one window leaves the other resolvable', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.add(2, owned('w2'));
    windows.setHostSender(1, 11);
    windows.setHostSender(2, 21);

    windows.remove(1);

    expect(windows.windowForSender(11)).toBeNull();
    expect(windows.windowForSender(21)).toBe(2);
    expect(windows.windowIds).toEqual([2]);
  });

  it('adding the same window twice does not duplicate it', () => {
    const windows = createPapersWindowRegistry<Owned>();
    const first = windows.add(1, owned('w1'));
    windows.setHostSender(1, 11);
    const second = windows.add(1, owned('w1'));

    expect(second.windowId).toBe(first.windowId);
    expect(windows.size).toBe(1);
    expect(windows.windowForSender(11)).toBe(1);
  });

  it('a renderer replaced in the same window resolves to that window', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.setHostSender(1, 11);
    windows.setHostSender(1, 12);

    expect(windows.windowForSender(11)).toBeNull();
    expect(windows.windowForSender(12)).toBe(1);
  });

  it('resolves what a window owns from any of its senders', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.add(2, owned('w2'));
    windows.setHostSender(1, 11);
    windows.setHostSender(2, 21);

    // A per-window operation resolves sender -> window -> that window's own
    // runtime, never "the" runtime.
    expect(windows.ownedForSender(11)?.label).toBe('w1');
    expect(windows.ownedForSender(21)?.label).toBe('w2');
    expect(windows.ownedForSender(999)).toBeNull();
  });

  it('lists every live context for genuinely application-wide delivery', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.add(2, owned('w2'));
    expect(windows.all().map((c) => c.owned.label).sort()).toEqual(['w1', 'w2']);
    windows.remove(1);
    expect(windows.all().map((c) => c.owned.label)).toEqual(['w2']);
  });

  it('hands back a copy, so a caller cannot rewrite the registry through it', () => {
    const windows = createPapersWindowRegistry<Owned>();
    windows.add(1, owned('w1'));
    windows.setHostSender(1, 11);

    const read = windows.get(1)!;
    read.hostSenderId = 999;

    expect(windows.windowForSender(11)).toBe(1);
    expect(windows.windowForSender(999)).toBeNull();
  });

  describe('the Hermes dock owner', () => {
    it('is nobody until a window explicitly docks', () => {
      const windows = createPapersWindowRegistry<Owned>();
      windows.add(1, owned('w1'));
      expect(windows.hermesDockOwner()).toBeNull();
    });

    it('transfers only on an explicit dock, never because another window is used', () => {
      const windows = createPapersWindowRegistry<Owned>();
      windows.add(1, owned('w1'));
      windows.add(2, owned('w2'));

      windows.setHermesDockOwner(1);
      expect(windows.hermesDockOwner()).toBe(1);

      // Window 2 being interacted with changes nothing. Focus must never move
      // a live Hermes session between windows.
      expect(windows.windowForSender(21)).toBeNull();
      expect(windows.hermesDockOwner()).toBe(1);

      // Only a deliberate Dock press in window 2 transfers ownership.
      windows.setHermesDockOwner(2);
      expect(windows.hermesDockOwner()).toBe(2);
    });

    it('is released when detached, because a detached Hermes belongs to no window', () => {
      const windows = createPapersWindowRegistry<Owned>();
      windows.add(1, owned('w1'));
      windows.setHermesDockOwner(1);

      windows.setHermesDockOwner(null);

      expect(windows.hermesDockOwner()).toBeNull();
    });

    it('is released when the owning window closes, without disturbing other windows', () => {
      const windows = createPapersWindowRegistry<Owned>();
      windows.add(1, owned('w1'));
      windows.add(2, owned('w2'));
      windows.setHostSender(2, 21);
      windows.setHermesDockOwner(1);

      windows.remove(1);

      expect(windows.hermesDockOwner()).toBeNull();
      expect(windows.windowForSender(21)).toBe(2);
    });

    it('cannot be given to a window that does not exist', () => {
      const windows = createPapersWindowRegistry<Owned>();
      windows.add(1, owned('w1'));
      windows.setHermesDockOwner(99);
      expect(windows.hermesDockOwner()).toBeNull();
    });
  });
});
