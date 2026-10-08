import { describe, expect, it } from 'vitest';
import { createEditorRuntimePool } from '../../src/main/backpacks/editorRuntimePool';

describe('shared editor runtime lifecycle', () => {
  it('keeps only one idle runtime, separates concurrent leases and retires unsafe engines', () => {
    let count = 0;
    const retired: number[] = [];
    const pool = createEditorRuntimePool({ create: () => ({ id: ++count, alive: true }), usable: r => r.alive, retire: r => { r.alive = false; retired.push(r.id); } });
    const first = pool.acquire(), concurrent = pool.acquire();
    expect(first).not.toBe(concurrent);
    pool.release(first, true); pool.release(concurrent, true);
    expect(retired).toEqual([concurrent.id]);
    expect(pool.acquire()).toBe(first);
    expect(() => pool.dispose()).toThrow('active editor');
    pool.release(first, false);
    const fresh = pool.acquire(); expect(fresh.id).toBe(3);
    pool.release(fresh, true); fresh.alive = false;
    const recovered = pool.acquire(); expect(recovered.id).toBe(4);
    pool.release(recovered, true); pool.dispose();
    expect(retired).toEqual([2, 1, 3, 4]);
    expect(() => pool.acquire()).toThrow('closed');
  });
});
