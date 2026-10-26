import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Audit writes use a server-only service-role client because authenticated clients are not allowed to insert audit events. */
export async function writeAuditLog(input: {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: input.actorId ?? null,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) console.error("audit_log_write_failed", { code: error.code, message: error.message });
  } catch (error) {
    console.error("audit_log_write_failed", error instanceof Error ? error.message : "unknown");
  }
}
