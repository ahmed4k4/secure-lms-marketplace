'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { DictKey, Locale } from './shared';

type Ctx = { locale: Locale; dict: Record<string, string> };
const I18nContext = createContext<Ctx>({ locale: 'en', dict: {} });

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Record<string, string>; children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, dict }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const { locale, dict } = useContext(I18nContext);
  const t = (key: DictKey, vars?: Record<string, string | number>) => {
    const raw = dict[key] ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : raw;
  };
  return { t, locale };
}
