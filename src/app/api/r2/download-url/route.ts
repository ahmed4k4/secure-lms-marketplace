import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { createR2DownloadUrl, getR2Limits } from "@/lib/server/r2";
import { canReadLessonContent, getCourseForLesson } from "@/lib/server/r2-access";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ resourceId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`r2-download:${user.id}`, 40);
  if (!rate.allowed) return NextResponse.json({ error: "Too many download requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });

  const roles = await getUserRoles(user.id);
  const admin = createAdminClient();
  const { data: resource, error: resourceError } = await admin.from("lesson_resources")
    .select("id,lesson_id,title,storage_path,mime_type,size_bytes").eq("id", parsed.data.resourceId).maybeSingle();
  if (resourceError || !resource) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  const parent = await getCourseForLesson(admin, resource.lesson_id);
  if (!parent || !(await canReadLessonContent({ admin, userSupabase, userId: user.id, roles, course: parent.course, lesson: parent.lesson }))) {
    return NextResponse.json({ error: "You do not have access to this resource" }, { status: 403 });
  }
  if (!resource.storage_path || !resource.mime_type) return NextResponse.json({ error: "Resource storage metadata is incomplete" }, { status: 409 });
  try {
    const expiresIn = getR2Limits().downloadTtlSeconds;
    const downloadUrl = await createR2DownloadUrl({ key: resource.storage_path, contentType: resource.mime_type, fileName: resource.title, expiresIn });
    return NextResponse.json({ downloadUrl, expiresIn }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    console.error("r2_download_url_error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Private file storage is not configured" }, { status: 503 });
  }
}
