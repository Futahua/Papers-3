import { describe, expect, it } from 'vitest';

import {
  parseCandidatePickerNavigation,
  parseCandidatePickerSignal,
} from '../../src/main/windows/candidatePickerSignal';

const candidates = new Set(['c1', 'c2']);

describe('candidate picker signal parser', () => {
  it('accepts only the fixed envelope and known candidate-specific actions', () => {
    expect(parseCandidatePickerSignal({ action: 'select', candidateId: 'c1' }, candidates))
      .toEqual({ action: 'select', candidateId: 'c1' });
    expect(parseCandidatePickerSignal({ action: 'peek', candidateId: 'missing' }, candidates)).toBeNull();
    expect(parseCandidatePickerSignal({ action: 'select', candidateId: 'c1', extra: true }, candidates)).toBeNull();
    expect(parseCandidatePickerSignal({ action: 'execute', candidateId: 'c1' }, candidates)).toBeNull();
  });

  it('bounds ids and normalizes non-candidate actions to a null id', () => {
    expect(parseCandidatePickerSignal({ action: 'cancel', candidateId: 'ignored' }, candidates))
      .toEqual({ action: 'cancel', candidateId: null });
    expect(parseCandidatePickerSignal({ action: 'direct-pick', candidateId: '' }, candidates))
      .toEqual({ action: 'direct-pick', candidateId: null });
    expect(parseCandidatePickerSignal({ action: 'peek', candidateId: 'x'.repeat(513) }, candidates)).toBeNull();
  });

  it('parses only the fixed papers-picker navigation host and known routes', () => {
    expect(parseCandidatePickerNavigation('https://papers-picker.invalid/select/c2', candidates))
      .toEqual({ action: 'select', candidateId: 'c2' });
    expect(parseCandidatePickerNavigation('https://papers-picker.invalid/peek/c1', candidates))
      .toEqual({ action: 'peek', candidateId: 'c1' });
    expect(parseCandidatePickerNavigation('https://papers-picker.invalid/cancel', candidates))
      .toEqual({ action: 'cancel', candidateId: null });
    expect(parseCandidatePickerNavigation('https://example.com/select/c1', candidates)).toBeNull();
    expect(parseCandidatePickerNavigation('not a url', candidates)).toBeNull();
  });
});
