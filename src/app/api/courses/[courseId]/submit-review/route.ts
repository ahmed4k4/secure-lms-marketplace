import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive, isInstructorApproved } from "@/lib/server/auth";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { localRateLimit } from "@/lib/server/rate-limit";
import { writeAuditLog } from "@/lib/server/audit";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const { courseId } = await params;
  if (!z.string().uuid().safeParse(courseId).success) return NextResponse.json({ error: "Invalid course ID" }, { status: 400 });
  const session = await createClient(); const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => ["instructor", "super_admin"].includes(role))) return NextResponse.json({ error: "Instructor role required" }, { status: 403 }); if (roles.includes("instructor") && !roles.includes("super_admin") && !(await isInstructorApproved(user.id))) return NextResponse.json({ error: "Instructor approval required before submitting courses" }, { status: 403 });
  const rate = localRateLimit(`course-review-submit:${user.id}`, 8);
  if (!rate.allowed) return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  const db = createAdminClient();
  const { data: course, error: courseError } = await db.from("courses").select("id,owner_id,status,title_en,title_ar").eq("id", courseId).maybeSingle();
  if (courseError || !course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  if (course.owner_id !== user.id && !roles.includes("super_admin")) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });
  if (!["draft"].includes(course.status)) return NextResponse.json({ error: "Only a draft course can be submitted for review" }, { status: 409 });
  const { data: sections, error: sectionError } = await db.from("sections").select("id").eq("course_id", courseId);
  if (sectionError || !sections?.length) return NextResponse.json({ error: "Add at least one section before submitting" }, { status: 409 });
  const { data: lessons, error: lessonError } = await db.from("lessons").select("id,kind,r2_object_key,processing_status,title_en").in("section_id", sections.map((section) => section.id));
  if (lessonError || !lessons?.length) return NextResponse.json({ error: "Add at least one lesson before submitting" }, { status: 409 });
  const incompleteVideo = lessons.find((lesson) => lesson.kind === "video" && (!lesson.r2_object_key || lesson.processing_status !== "ready"));
  if (incompleteVideo) return NextResponse.json({ error: `Video lesson “${String(incompleteVideo.title_en).slice(0, 120)}” is not stored in private R2 storage or is not ready. Re-upload it from the lesson editor.` }, { status: 409 });
  const { data: product } = await db.from("products").select("id").eq("course_id", courseId).eq("kind", "course").eq("is_active", true).maybeSingle();
  const { data: plans } = product ? await db.from("pricing_plans").select("id").eq("product_id", product.id).eq("is_active", true).limit(1) : { data: [] as { id: string }[] };
  if (!plans?.length) return NextResponse.json({ error: "Configure at least one active pricing plan (a free plan is supported) before review" }, { status: 409 });
  const { error: updateError } = await db.from("courses").update({ status: "in_review", updated_at: new Date().toISOString() }).eq("id", courseId).eq("status", "draft");
  if (updateError) { console.error("course_submit_review_failed", JSON.stringify({ code: updateError.code ?? "unknown" })); return NextResponse.json({ error: "Could not submit this course for review" }, { status: 503 }); }
  await writeAuditLog({ actorId: user.id, action: "course.submitted_for_review", targetType: "course", targetId: courseId, metadata: { title: course.title_en, lessonCount: lessons.length } });
  return NextResponse.json({ success: true, status: "in_review" }, { headers: { "Cache-Control": "no-store" } });
}
