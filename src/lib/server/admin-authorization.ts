import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountState, getUserRoles, type AppRole } from "@/lib/server/auth";

export type AdminActor = { id: string; email: string | undefined; roles: AppRole[]; permissions: string[] };
export type AdminAuthorizationResult =
  | { ok: true; actor: AdminActor; db: ReturnType<typeof createAdminClient> }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** Call from Route Handlers only. Actor identity always comes from Supabase Auth. */
export async function authorizeAdminApi(allowedRoles: AppRole[] = ["admin", "super_admin"]): Promise<AdminAuthorizationResult> {
  let client;
  try { client = await createClient(); }
  catch { return { ok: false, status: 503, error: "Authentication is not configured" }; }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, status: 401, error: "Authentication required" };
  const [state, roles] = await Promise.all([getAccountState(data.user.id), getUserRoles(data.user.id)]);
  if (state !== "active") return { ok: false, status: 403, error: "An active account is required" };
  if (!roles.some((role) => allowedRoles.includes(role))) return { ok: false, status: 403, error: "Insufficient permissions" };
  try {
    const db = createAdminClient();
    let permissions: string[] = [];
    if (!roles.includes("super_admin")) {
      const { data: permissionRows, error: permissionError } = await db.from("user_permissions").select("permission_key").eq("user_id", data.user.id);
      if (permissionError) {
        console.error("admin_permission_lookup_failed", JSON.stringify({ code: permissionError.code ?? "unknown", message: permissionError.message?.slice(0, 200) }));
        return { ok: false, status: 503, error: "Administrator permissions are unavailable. Apply migration 0007." };
      }
      permissions = (permissionRows ?? []).map((row) => row.permission_key as string);
    }
    return { ok: true, actor: { id: data.user.id, email: data.user.email, roles, permissions }, db };
  } catch { return { ok: false, status: 503, error: "Trusted server database access is not configured" }; }
}
export function hasAdminPermission(actor: AdminActor, permission: string): boolean {
  return actor.roles.includes("super_admin") || actor.permissions.includes(permission);
}
