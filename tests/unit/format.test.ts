import { describe, it, expect } from 'vitest';
import { formatCount, formatDate, formatHM, formatPrice } from '@/lib/utils';

describe('formatting follows the brand rule: Latin digits 0-9, even in Arabic', () => {
  const arabicIndic = /[\u0660-\u0669\u06F0-\u06F9]/;
  it('prices, counts and dates never use Arabic-Indic digits', () => {
    for (const out of [formatPrice(4900, 'USD', 'ar'), formatPrice(12550, 'EGP', 'ar'), formatCount(3120, 'ar'), formatDate('2026-10-24', 'ar')]) {
      expect(out).not.toMatch(arabicIndic);
      expect(out).toMatch(/[0-9]/);
    }
  });
  it('formats English prices compactly', () => {
    expect(formatPrice(4900, 'USD', 'en')).toBe('$49');
    expect(formatPrice(4950, 'USD', 'en')).toBe('$49.50');
    expect(formatPrice(null, 'USD', 'en')).toBe('');
  });
  it('formats durations', () => {
    expect(formatHM(0, { h: 'h', m: 'min' })).toBe('');
    expect(formatHM(2400, { h: 'h', m: 'min' })).toBe('40 min');
    expect(formatHM(7500, { h: 'h', m: 'min' })).toBe('2 h 5 min');
    expect(formatHM(7200, { h: 'س', m: 'د' })).toBe('2 س');
  });
});
