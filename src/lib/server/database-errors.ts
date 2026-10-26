export type DatabaseIssue = "missing_configuration" | "network" | "schema_missing" | "permission_denied" | "unknown";
export function classifyDatabaseIssue(error: unknown): DatabaseIssue {
  const e: { code?: string; message?: string; name?: string; status?: number } = error && typeof error === "object" ? error as { code?: string; message?: string; name?: string; status?: number } : { message: String(error) };
  const code = (e.code ?? "").toUpperCase();
  const message = (e.message ?? "").toLowerCase();
  if (message.includes("environment variables are not configured") || message.includes("missing supabase") || message.includes("invalid supabaseurl") || message.includes("invalid url")) return "missing_configuration";
  if (["PGRST205", "PGRST204", "42P01", "42703", "42883"].includes(code) || message.includes("does not exist") || message.includes("schema cache")) return "schema_missing";
  if (["42501", "PGRST301", "PGRST302", "401", "403"].includes(code) || e.status === 401 || e.status === 403 || message.includes("permission denied") || message.includes("row-level security")) return "permission_denied";
  if (e.name === "FetchError" || message.includes("fetch failed") || message.includes("failed to fetch") || message.includes("network") || message.includes("enotfound") || message.includes("econn")) return "network";
  return "unknown";
}
export function databaseIssueMessage(issue: DatabaseIssue, locale: "ar" | "en"): string {
  const ar = locale === "ar";
  switch (issue) {
    case "missing_configuration": return ar ? "إعدادات Supabase غير مكتملة. أضف NEXT_PUBLIC_SUPABASE_URL وNEXT_PUBLIC_SUPABASE_ANON_KEY إلى .env.local ثم أعد تشغيل الموقع." : "Supabase configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the app.";
    case "network": return ar ? "تعذر الاتصال بـ Supabase. تحقق من الاتصال بالإنترنت ورابط المشروع وحالته." : "Could not reach Supabase. Check your network, project URL, and project status.";
    case "schema_missing": return ar ? "اتصل الموقع بـ Supabase، لكن مخطط قاعدة البيانات غير مكتمل. طبّق ملفات الترحيل بالترتيب على المشروع الصحيح." : "Supabase is reachable, but the database schema is incomplete. Apply migrations in order to the correct project.";
    case "permission_denied": return ar ? "اتصل الموقع بقاعدة البيانات، لكن صلاحيات القراءة أو سياسات RLS تمنع استرجاع البيانات. راجع منح الصلاحيات والسياسات." : "The database is reachable, but grants or RLS policies deny this query. Review database grants and policies.";
    default: return ar ? "تعذر تحميل الكورسات بسبب خطأ غير متوقع في قاعدة البيانات. راجع سجلات السيرفر باستخدام رمز الطلب إن توفر." : "Courses could not be loaded due to an unexpected database error. Review server logs for details.";
  }
}
