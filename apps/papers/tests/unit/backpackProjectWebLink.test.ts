import { describe, expect, it } from 'vitest';
import { parseBackpackProjectWebUrl } from '../../src/main/backpacks/backpackProjectWebLink';

describe('Backpack project web links', () => {
  it('accepts only normalized http(s) addresses', () => {
    expect(parseBackpackProjectWebUrl('https://example.com/docs')).toBe(
      'https://example.com/docs',
    );
    expect(parseBackpackProjectWebUrl('http://example.com')).toBe('http://example.com/');
    expect(() => parseBackpackProjectWebUrl('javascript:alert(1)')).toThrow(
      /only http\(s\)/i,
    );
    expect(() => parseBackpackProjectWebUrl('not a URL')).toThrow();
  });
});
