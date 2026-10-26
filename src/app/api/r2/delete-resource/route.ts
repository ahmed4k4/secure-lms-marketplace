import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { deleteR2Object } from "@/lib/server/r2";
import { canManageCourse, getCourseForLesson } from "@/lib/server/r2-access";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ resourceId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`r2-delete:${user.id}`, 20);
  if (!rate.allowed) return NextResponse.json({ error: "Too many delete requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  const roles = await getUserRoles(user.id);
  const admin = createAdminClient();
  const { data: resource, error: resourceError } = await admin.from("lesson_resources")
    .select("id,lesson_id,storage_path,title").eq("id", parsed.data.resourceId).maybeSingle();
  if (resourceError || !resource) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  const parent = await getCourseForLesson(admin, resource.lesson_id);
  if (!parent || !canManageCourse(parent.course, user.id, roles)) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });
  try {
    await deleteR2Object(resource.storage_path);
    const { error: deleteError } = await admin.from("lesson_resources").delete().eq("id", resource.id);
    if (deleteError) throw new Error("Could not remove resource metadata");
    await writeAuditLog({ actorId: user.id, action: "r2.resource.deleted", targetType: "lesson_resource", targetId: resource.id, metadata: { lessonId: resource.lesson_id } });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    console.error("r2_resource_delete_error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not remove resource; retry the action or inspect server logs" }, { status: 503 });
  }
}
