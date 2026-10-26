/** Restrict auth callback destinations to local routes inside the current locale. */
export function safeNextPath(value: string | null, locale: string): string {
  const fallback = `/${locale}/dashboard`;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const path = new URL(value, "https://local.invalid");
    if (path.origin !== "https://local.invalid" || !path.pathname.startsWith(`/${locale}/`)) return fallback;
    return `${path.pathname}${path.search}${path.hash}`;
  } catch { return fallback; }
}
