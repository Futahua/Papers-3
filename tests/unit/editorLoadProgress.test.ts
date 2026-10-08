import { expect, it } from 'vitest';
import { editorLoadProgress } from '../../src/main/backpacks/editorLoadProgress';
it('retains reported stage values and leaves unknown totals indeterminate', () => {
  expect(editorLoadProgress({ phase: 'load', text: 'Reading', value: 73, maximum: 200 })).toMatchObject({ value: 73, maximum: 200 });
  expect(editorLoadProgress({ value: 50 })).toMatchObject({ value: null, maximum: null });
  expect(editorLoadProgress({ value: 900, maximum: 100 })).toMatchObject({ value: 100, maximum: 100 });
  expect(editorLoadProgress({ value: Infinity, maximum: NaN })).toMatchObject({ value: null, maximum: null });
});
