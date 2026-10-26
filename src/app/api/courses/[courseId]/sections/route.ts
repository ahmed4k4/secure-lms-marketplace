import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { localRateLimit } from "@/lib/server/rate-limit";
import { writeAuditLog } from "@/lib/server/audit";

const schema = z.object({
  titleEn: z.string().trim().min(1).max(180),
  titleAr: z.string().trim().min(1).max(180),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const { courseId } = await params;
  if (!z.string().uuid().safeParse(courseId).success) return NextResponse.json({ error: "Invalid course ID" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`section-create:${user.id}`, 20);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const roles = await getUserRoles(user.id);
  const admin = roles.includes("super_admin");
  if (!admin && !roles.includes("instructor")) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });

  const { data: course } = await supabase.from("courses").select("id,owner_id").eq("id", courseId).maybeSingle();
  if (!course || (!admin && course.owner_id !== user.id)) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid section fields" }, { status: 400 });

  const { data, error } = await supabase.from("sections").insert({
    course_id: courseId,
    title_en: parsed.data.titleEn,
    title_ar: parsed.data.titleAr,
    sort_order: parsed.data.sortOrder,
  }).select("id,title_en,title_ar,sort_order").single();
  if (error) return NextResponse.json({ error: "Could not create section" }, { status: 400 });
  await writeAuditLog({ actorId: user.id, action: "section.created", targetType: "section", targetId: data.id, metadata: { courseId } });
  return NextResponse.json({ section: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
