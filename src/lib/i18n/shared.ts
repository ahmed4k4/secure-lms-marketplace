import type { en } from './en';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];
export type DictKey = keyof typeof en;
export const dirOf = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');
