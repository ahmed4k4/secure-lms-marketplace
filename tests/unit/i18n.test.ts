import { describe, it, expect } from 'vitest';
import { en } from '@/lib/i18n/en';
import { ar } from '@/lib/i18n/ar';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('i18n dictionaries', () => {
  it('Arabic and English have identical keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it('placeholders match between languages and no value is empty', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(ar[k].trim(), k).not.toBe('');
      expect(placeholders(ar[k]), k).toBe(placeholders(en[k]));
    }
  });
});
