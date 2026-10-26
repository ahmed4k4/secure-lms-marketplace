import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Brand rule: Latin digits 0-9 everywhere (prices, dates, counts), even in Arabic. */
const intlLocale = (locale: string) => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US');

export function formatPrice(cents: number | null | undefined, currency = 'USD', locale = 'en') {
  if (cents == null) return '';
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

export function formatDate(value: string | Date | null | undefined, locale = 'en') {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

export function formatCount(n: number, locale = 'en') {
  return new Intl.NumberFormat(intlLocale(locale), { notation: n >= 10000 ? 'compact' : 'standard' }).format(n);
}

/** "3h 20m" / "3 س 20 د" with Latin digits. */
export function formatHM(seconds: number | null | undefined, units: { h: string; m: string }) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${Math.max(m, 1)} ${units.m}`;
  return m ? `${h} ${units.h} ${m} ${units.m}` : `${h} ${units.h}`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** URL-safe slug; non-latin titles fall back to a random suffix so slugs are always valid and unique-ish. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : `course-${suffix}`;
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

/** Only allow same-site relative redirects (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/dashboard') {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
