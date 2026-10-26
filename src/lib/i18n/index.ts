import 'server-only';
import { cookies } from 'next/headers';
import { en } from './en';
import { ar } from './ar';
import type { DictKey, Locale } from './shared';

export * from './shared';
const dictionaries = { en, ar } as const;

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get('locale')?.value;
  return v === 'ar' ? 'ar' : 'en';
}

export function translate(locale: Locale, key: DictKey, vars?: Record<string, string | number>) {
  const raw: string = dictionaries[locale][key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : raw;
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars) };
}

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}
