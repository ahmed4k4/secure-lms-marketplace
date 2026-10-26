import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

const schema = z.object({ action: z.enum(["approve", "reject", "archive", "unarchive", "feature", "unfeature"]) });
export async function PATCH(request: Request, context: { params: Promise<{ courseId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { courseId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) return NextResponse.json({ error: "Invalid course ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid course moderation action" }, { status: 400 });
  if (["approve", "reject", "archive", "unarchive"].includes(parsed.data.action) && !hasAdminPermission(auth.actor, "courses.review")) return NextResponse.json({ error: "You do not have permission to review courses." }, { status: 403 });
  const { data: current, error: readError } = await auth.db.from("courses").select("id,owner_id,status,is_featured,title_en,title_ar").eq("id", courseId).maybeSingle();
  if (readError) return NextResponse.json({ error: "Could not load course details." }, { status: 503 });
  if (!current) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  let update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let auditAction = "admin.course.updated";
  switch (parsed.data.action) {
    case "approve": {
      if (current.status !== "in_review" && !(auth.actor.roles.includes("super_admin") && current.status === "draft")) return NextResponse.json({ error: "Only courses awaiting review can be approved (Super Admins may approve a draft explicitly)." }, { status: 409 });
      const { data: categoryHold } = await auth.db.from("course_category_holds").select("course_id,category_request_id,category_requests!inner(status)").eq("course_id", courseId).maybeSingle();
      if (categoryHold && Array.isArray(categoryHold.category_requests) && categoryHold.category_requests.some((item: { status: string }) => item.status !== "approved")) return NextResponse.json({ error: "This course is on hold until its proposed category is approved or resolved." }, { status: 409 });
      const { data: sections, error: sectionError } = await auth.db.from("sections").select("id").eq("course_id", courseId);
      if (sectionError || !sections?.length) return NextResponse.json({ error: "Add at least one course section before publishing." }, { status: 409 });
      const { data: lessons, error: lessonsError } = await auth.db.from("lessons").select("id,kind,r2_object_key,processing_status,title_en").in("section_id", sections.map((section: { id: string }) => section.id));
      if (lessonsError || !lessons?.length) return NextResponse.json({ error: "Add at least one lesson before publishing." }, { status: 409 });
      const invalidVideo = lessons.find((lesson: { kind: string; r2_object_key: string | null; processing_status: string; title_en: string }) => lesson.kind === "video" && (!lesson.r2_object_key || lesson.processing_status !== "ready"));
      if (invalidVideo) return NextResponse.json({ error: `Video lesson “${String(invalidVideo.title_en).slice(0, 100)}” is missing its private R2 upload. Re-upload it before publishing.` }, { status: 409 });
      const { data: product } = await auth.db.from("products").select("id").eq("course_id", courseId).eq("kind", "course").eq("is_active", true).maybeSingle();
      const { data: plans } = product ? await auth.db.from("pricing_plans").select("id").eq("product_id", product.id).eq("is_active", true).limit(1) : { data: [] as { id: string }[] };
      if (!plans?.length) return NextResponse.json({ error: "Configure at least one active pricing plan (free access is supported) before publishing." }, { status: 409 });
      const { error: lessonPublishError } = await auth.db.from("lessons").update({ is_published: true }).in("section_id", sections.map((section: { id: string }) => section.id));
      if (lessonPublishError) return NextResponse.json({ error: "The course could not publish its lessons. Check the current database migrations." }, { status: 503 });
      update.status = "published"; update.published_at = new Date().toISOString(); auditAction = "admin.course.approved"; break;
    }
    case "reject":
      if (current.status !== "in_review") return NextResponse.json({ error: "Only courses awaiting review can be rejected." }, { status: 409 });
      update.status = "draft"; update.published_at = null; auditAction = "admin.course.rejected"; break;
    case "archive":
      update.status = "archived"; auditAction = "admin.course.archived"; break;
    case "unarchive":
      if (current.status !== "archived") return NextResponse.json({ error: "This course is not archived." }, { status: 409 });
      update.status = "draft"; update.published_at = null; auditAction = "admin.course.unarchived"; break;
    case "feature":
      if (!auth.actor.roles.includes("super_admin")) return NextResponse.json({ error: "Only a Super Admin can feature courses." }, { status: 403 });
      update.is_featured = true; auditAction = "admin.course.featured"; break;
    case "unfeature":
      if (!auth.actor.roles.includes("super_admin")) return NextResponse.json({ error: "Only a Super Admin can feature courses." }, { status: 403 });
      update.is_featured = false; auditAction = "admin.course.unfeatured"; break;
  }
  const { error } = await auth.db.from("courses").update(update).eq("id", courseId);
  if (error) {
    console.error("admin_course_update_failed", JSON.stringify({ code: error.code ?? "unknown", message: error.message?.slice(0, 220) }));
    if (parsed.data.action === "approve") {
      const { data: sections } = await auth.db.from("sections").select("id").eq("course_id", courseId);
      if (sections?.length) await auth.db.from("lessons").update({ is_published: false }).in("section_id", sections.map((section: { id: string }) => section.id));
    }
    return NextResponse.json({ error: "Could not update course. Check schema and publication rules." }, { status: 500 });
  }
  await writeAuditLog({ actorId: auth.actor.id, action: auditAction, targetType: "course", targetId: courseId, metadata: { from: current.status, action: parsed.data.action } });
  return NextResponse.json({ success: true });
}
