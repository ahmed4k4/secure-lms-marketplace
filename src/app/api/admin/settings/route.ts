import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export async function GET() {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.roles.includes("super_admin")) return NextResponse.json({ error: "Only a Super Admin can view platform settings." }, { status: 403 });
  const { data, error } = await auth.db.from("platform_settings").select("key,value,description,updated_at").order("key");
  if (error) {
    console.error("admin_settings_read_failed", JSON.stringify({ code: error.code ?? "unknown", message: error.message?.slice(0, 200) }));
    return NextResponse.json({ error: "Platform settings are unavailable. Apply migration 0007." }, { status: 503 });
  }
  return NextResponse.json({ settings: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

const schema = z.object({
  commissionBps: z.number().int().min(0).max(10000),
  requireInstructorApproval: z.boolean(),
  requireCourseReview: z.boolean(),
  maxResourceBytes: z.number().int().min(1_048_576).max(104_857_600),
});
export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.roles.includes("super_admin")) return NextResponse.json({ error: "Only a Super Admin can change platform settings." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings. Commission must be 0–100%, and resource size must be 1–100 MiB." }, { status: 400 });
  const settings = [
    { key: "platform.commission_bps", value: parsed.data.commissionBps, description: "Platform commission in basis points. Payments are disabled in Phase 1." },
    { key: "instructors.require_approval", value: parsed.data.requireInstructorApproval, description: "New instructor profiles require admin approval." },
    { key: "courses.require_review", value: parsed.data.requireCourseReview, description: "Courses must pass admin review before publication." },
    { key: "uploads.max_resource_bytes", value: parsed.data.maxResourceBytes, description: "Maximum general resource upload size in bytes." },
  ].map((setting) => ({ ...setting, updated_by: auth.actor.id, updated_at: new Date().toISOString() }));
  const { error } = await auth.db.from("platform_settings").upsert(settings, { onConflict: "key" });
  if (error) {
    console.error("admin_settings_update_failed", JSON.stringify({ code: error.code ?? "unknown", message: error.message?.slice(0, 220) }));
    return NextResponse.json({ error: "Could not save settings. Check migration 0007." }, { status: 500 });
  }
  await writeAuditLog({ actorId: auth.actor.id, action: "admin.platform_settings.updated", targetType: "platform_settings", metadata: { keys: settings.map((setting) => setting.key) } });
  return NextResponse.json({ success: true });
}
