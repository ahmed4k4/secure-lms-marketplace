import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AppRole = "super_admin" | "admin" | "instructor" | "student";
const knownRoles = new Set<AppRole>(["super_admin", "admin", "instructor", "student"]);
function safeDbMessage(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return value.replace(/(?:sb_secret_|eyJ)[A-Za-z0-9_.-]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 300);
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/** Server-only role lookup via the trusted service client. The user ID passed here must
 * originate from supabase.auth.getUser(); never call this with an untrusted browser ID. */
export async function getUserRoles(userId: string): Promise<AppRole[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      console.error("user_roles_query_failed", JSON.stringify({ code: error.code ?? "unknown", message: safeDbMessage(error.message), details: safeDbMessage(error.details) }));
      return [];
    }
    return [...new Set((data ?? []).map((row) => row.role as AppRole).filter((role) => knownRoles.has(role)))];
  } catch (error) {
    console.error("user_roles_query_exception", JSON.stringify({ message: safeDbMessage(error instanceof Error ? error.message : "unknown") }));
    return [];
  }
}

export type AccountState = "active" | "suspended" | "pending" | "missing" | "error";
export async function getAccountState(userId: string): Promise<AccountState> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("profiles").select("status").eq("id", userId).maybeSingle();
    if (error) {
      console.error("profile_status_query_failed", JSON.stringify({ code: error.code ?? "unknown", message: safeDbMessage(error.message) }));
      return "error";
    }
    if (!data) return "missing";
    if (data.status === "active" || data.status === "suspended" || data.status === "pending") return data.status;
    return "error";
  } catch (error) {
    console.error("profile_status_query_exception", JSON.stringify({ message: safeDbMessage(error instanceof Error ? error.message : "unknown") }));
    return "error";
  }
}
export async function isAccountActive(userId: string): Promise<boolean> {
  return (await getAccountState(userId)) === "active";
}
export async function requireUser(locale: string) {
  const user = await getAuthenticatedUser();
  if (!user) redirect(`/${locale}/sign-in`);
  const state = await getAccountState(user.id);
  if (state === "suspended") redirect(`/${locale}/sign-in?account=suspended`);
  if (state === "pending") redirect(`/${locale}/sign-in?account=pending`);
  if (state === "missing") redirect(`/${locale}/sign-in?account=setup`);
  if (state === "error") redirect(`/${locale}/sign-in?account=profile_error`);
  return user;
}
export async function requireAnyRole(locale: string, allowed: AppRole[]) {
  const user = await requireUser(locale);
  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => allowed.includes(role))) redirect(`/${locale}/dashboard?denied=1`);
  return { user, roles };
}

/** Instructor approval is required before submitting a draft for public review; draft preparation remains allowed. */
export async function isInstructorApproved(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("instructor_profiles").select("is_approved").eq("user_id", userId).maybeSingle();
    if (error) {
      console.error("instructor_approval_query_failed", JSON.stringify({ code: error.code ?? "unknown", message: safeDbMessage(error.message) }));
      return false;
    }
    return data?.is_approved === true;
  } catch (error) {
    console.error("instructor_approval_query_exception", JSON.stringify({ message: safeDbMessage(error instanceof Error ? error.message : "unknown") }));
    return false;
  }
}
