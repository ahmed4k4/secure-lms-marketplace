import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Service-role access bypasses RLS. Import this module only from server-only trusted workflows. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Server-side Supabase service role is required for this trusted workflow.");
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "secure-lms-server-admin" } },
  });
}
