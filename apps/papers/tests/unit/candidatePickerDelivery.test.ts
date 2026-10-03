import { describe, expect, it } from 'vitest';
import { createCandidatePickerDelivery } from '../../src/main/windows/candidatePickerDelivery';

describe('candidate picker page readiness', () => {
  it('buffers rows that beat loadURL and paints them when the document is ready', async () => {
    const painted: string[][] = [];
    const delivery = createCandidatePickerDelivery<string>(async (rows) => { painted.push(rows); return true; });
    expect(await delivery.update(['first'])).toBe('buffered');
    expect(painted).toEqual([]);
    expect(await delivery.markReady()).toBe('applied');
    expect(painted).toEqual([['first']]);
  });

  it('keeps only the newest pre-load update and drops a retired session', async () => {
    const painted: string[][] = [];
    const delivery = createCandidatePickerDelivery<string>(async (rows) => { painted.push(rows); return true; });
    expect(await delivery.update(['old'])).toBe('buffered');
    expect(await delivery.update(['new'])).toBe('buffered');
    expect(await delivery.markReady()).toBe('applied');
    expect(painted).toEqual([['new']]);
    delivery.close();
    expect(await delivery.update(['late'])).toBe('stale');
    expect(painted).toEqual([['new']]);
  });

  it('reports a failed document update and retains rows for a later retry', async () => {
    const painted: string[][] = [];
    let ready = false;
    const delivery = createCandidatePickerDelivery<string>(async (rows) => {
      if (!ready) return false;
      painted.push(rows);
      return true;
    });
    expect(await delivery.markReady()).toBe('applied');
    expect(await delivery.update(['candidate'])).toBe('failed');
    ready = true;
    expect(await delivery.markReady()).toBe('applied');
    expect(painted).toEqual([['candidate']]);
  });

  it('applies newer rows that arrive while a previous document update fails', async () => {
    const painted: string[][] = [];
    let failFirst!: (value: boolean) => void;
    const firstResult = new Promise<boolean>((resolve) => { failFirst = resolve; });
    let calls = 0;
    const delivery = createCandidatePickerDelivery<string>(async (rows) => {
      if (++calls === 1) return firstResult;
      painted.push(rows);
      return true;
    });
    await delivery.markReady();
    const first = delivery.update(['old']);
    const second = delivery.update(['new']);
    failFirst(false);
    expect(await first).toBe('applied');
    expect(await second).toBe('applied');
    expect(painted).toEqual([['new']]);
  });

  it('retries a buffered update after readiness and surfaces terminal failure', async () => {
    let attempts = 0;
    const delivery = createCandidatePickerDelivery<string>(async () => { attempts++; return false; });
    expect(await delivery.update(['candidate'])).toBe('buffered');
    expect(await delivery.markReadyWithRetry(3)).toBe('failed');
    expect(attempts).toBe(3);
  });
});
