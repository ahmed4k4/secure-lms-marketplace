import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";
const schema = z.object({ action: z.enum(["approve", "reject"]) });
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasAdminPermission(auth.actor, "categories.manage")) return NextResponse.json({ error: "Category management permission required" }, { status: 403 });
  const { requestId } = await context.params; const parsedId = z.string().uuid().safeParse(requestId); if (!parsedId.success) return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  let raw: unknown; try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: "Choose approve or reject" }, { status: 400 });
  const { data: proposal, error: readError } = await auth.db.from("category_requests").select("id,requester_id,name_en,name_ar,slug,status").eq("id", requestId).maybeSingle();
  if (readError || !proposal) return NextResponse.json({ error: "Category request not found. Apply migration 0012 first." }, { status: 404 });
  if (proposal.status !== "pending" && !(parsed.data.action === "approve" && proposal.status === "rejected")) return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });
  let categoryId: string | null = null;
  if (parsed.data.action === "approve") {
    const { data: existingCategory, error: categoryReadError } = await auth.db.from("categories").select("id").eq("slug", proposal.slug).maybeSingle();
    if (categoryReadError) return NextResponse.json({ error: "Could not check existing categories." }, { status: 503 });
    if (existingCategory) categoryId = existingCategory.id;
    else {
      const { data: category, error } = await auth.db.from("categories").insert({ slug: proposal.slug, name_en: proposal.name_en, name_ar: proposal.name_ar, sort_order: 0 }).select("id").single();
      if (error || !category) return NextResponse.json({ error: error?.code === "23505" ? "A category with this slug was just created. Refresh and retry." : "Could not create category." }, { status: error?.code === "23505" ? 409 : 500 });
      categoryId = category.id;
    }
  }
  const { data: holds, error: holdReadError } = await auth.db.from("course_category_holds").select("course_id").eq("category_request_id", requestId);
  if (holdReadError) return NextResponse.json({ error: "Could not load linked course holds. Apply migration 0013." }, { status: 503 });
  const courseIds = (holds ?? []).map((hold: { course_id: string }) => hold.course_id);
  if (parsed.data.action === "approve" && categoryId && courseIds.length) {
    // Attach the category before changing request status. The DB trigger keeps all held courses unpublished until this succeeds.
    const { error: attachError } = await auth.db.from("courses").update({ category_id: categoryId, updated_at: new Date().toISOString() }).in("id", courseIds);
    if (attachError) return NextResponse.json({ error: "The category exists, but one or more courses could not be linked. The publication hold remains in place; retry after reviewing database logs." }, { status: 500 });
  }
  const { error: updateError } = await auth.db.from("category_requests").update({ status: parsed.data.action === "approve" ? "approved" : "rejected", reviewed_by: auth.actor.id, reviewed_at: new Date().toISOString(), category_id: categoryId }).eq("id", requestId).in("status", parsed.data.action === "approve" ? ["pending", "rejected"] : ["pending"]);
  if (updateError) { console.error("category_request_review_failed", { code: updateError.code }); return NextResponse.json({ error: "Category review could not be saved. Linked courses remain held; retry after checking migration 0013." }, { status: 500 }); }
  if (parsed.data.action === "approve" && courseIds.length) {
    const { error: releaseError } = await auth.db.from("course_category_holds").delete().eq("category_request_id", requestId);
    if (releaseError) return NextResponse.json({ error: "The category is approved and linked, but the publication hold could not be cleared. Retry after checking migration 0013." }, { status: 500 });
  }
  await writeAuditLog({ actorId: auth.actor.id, action: `admin.category_request.${parsed.data.action}d`, targetType: "category_request", targetId: requestId, metadata: { categoryId, linkedCourseCount: courseIds.length } });
  return NextResponse.json({ success: true, action: parsed.data.action, categoryId, linkedCourseCount: courseIds.length }, { headers: { "Cache-Control": "no-store, private" } });
}
