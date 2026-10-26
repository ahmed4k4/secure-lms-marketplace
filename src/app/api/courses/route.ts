import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { courseCreateSchema } from "@/lib/schemas";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });

  const rate = localRateLimit(`course-create:${user.id}`, 10);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => ["instructor", "super_admin"].includes(role))) {
    return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
  }
  // Instructors may prepare drafts while their platform profile is awaiting approval.
  // Approval is enforced at the submission/publication boundary, not at draft creation.

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = courseCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid course fields", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });

  const value = parsed.data;
  const admin = createAdminClient();
  let categoryId = value.categoryId || null;
  let proposalSlug = "";
  let proposal: { nameEn: string; nameAr: string } | null = value.proposedCategory ?? null;
  if (proposal) {
    proposalSlug = proposal.nameEn.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    if (proposalSlug.length < 2) return NextResponse.json({ error: "The English category name must produce a valid category slug." }, { status: 400 });
    const { data: existingCategory, error: categoryReadError } = await admin.from("categories").select("id").eq("slug", proposalSlug).maybeSingle();
    if (categoryReadError) return NextResponse.json({ error: "Could not validate the proposed category. Check database migrations." }, { status: 503 });
    if (existingCategory) { categoryId = existingCategory.id; proposal = null; }
  }
  const { data, error } = await supabase.from("courses").insert({
    owner_id: user.id,
    slug: value.slug,
    title_en: value.titleEn,
    title_ar: value.titleAr,
    summary_en: value.summaryEn,
    summary_ar: value.summaryAr,
    description_en: value.descriptionEn,
    description_ar: value.descriptionAr,
    language: value.language,
    level: value.level,
    category_id: categoryId,
    thumbnail_url: value.thumbnailUrl || null,
    status: "draft",
  }).select("id,slug,status").single();

  if (error) {
    console.error("course_create_failed", JSON.stringify({ code: error.code ?? "unknown" }));
    const status = error.code === "23505" ? 409 : error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: status === 409 ? "That course URL is already in use" : status === 403 ? "Your account is not allowed to create course drafts. Ask the Super Admin to check your instructor role." : "Could not create course. Check the required fields and confirm the latest database migrations are applied." }, { status });
  }

  let categoryApprovalPending = false;
  if (proposal) {
    try {
      let { data: pendingRequest, error: pendingReadError } = await admin.from("category_requests").select("id,status").eq("slug", proposalSlug).eq("status", "pending").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (pendingReadError) throw new Error("Could not read existing category requests");
      if (!pendingRequest) {
        const { data: rejectedRequest, error: rejectedReadError } = await admin.from("category_requests").select("id,status").eq("slug", proposalSlug).eq("status", "rejected").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (rejectedReadError) throw new Error("Could not check prior category requests");
        if (rejectedRequest) {
          const { data: reopened, error: reopenError } = await admin.from("category_requests").update({ status: "pending", requester_id: user.id, name_en: proposal.nameEn, name_ar: proposal.nameAr, reviewed_by: null, reviewed_at: null, category_id: null }).eq("id", rejectedRequest.id).eq("status", "rejected").select("id,status").single();
          if (reopenError || !reopened) throw new Error("Could not reopen the rejected category request");
          pendingRequest = reopened;
        } else {
          const { data: createdRequest, error: requestError } = await admin.from("category_requests").insert({ requester_id: user.id, name_en: proposal.nameEn, name_ar: proposal.nameAr, slug: proposalSlug }).select("id,status").single();
          if (requestError || !createdRequest) {
            // Another instructor may have submitted the same slug concurrently; reuse that shared request.
            const { data: racedRequest, error: raceReadError } = await admin.from("category_requests").select("id,status").eq("slug", proposalSlug).eq("status", "pending").order("created_at", { ascending: true }).limit(1).maybeSingle();
            if (raceReadError || !racedRequest) throw new Error("Could not create or reuse the category request");
            pendingRequest = racedRequest;
          } else pendingRequest = createdRequest;
        }
      }
      if (pendingRequest.status === "pending") {
        const { error: holdError } = await admin.from("course_category_holds").upsert({ course_id: data.id, category_request_id: pendingRequest.id }, { onConflict: "course_id" });
        if (holdError) throw new Error("Could not link the course to the category approval");
        // Close the race where an administrator approves the category between our first read and hold creation.
        const { data: requestState, error: stateError } = await admin.from("category_requests").select("status,category_id").eq("id", pendingRequest.id).maybeSingle();
        if (stateError || !requestState) throw new Error("Could not verify the final category-request state");
        if (requestState.status === "approved") {
          if (!requestState.category_id) throw new Error("Approved category request has no category ID");
          const { error: attachError } = await admin.from("courses").update({ category_id: requestState.category_id, updated_at: new Date().toISOString() }).eq("id", data.id).eq("owner_id", user.id);
          if (attachError) throw new Error("Could not attach the newly approved category to this course");
          const { error: releaseError } = await admin.from("course_category_holds").delete().eq("course_id", data.id);
          if (releaseError) throw new Error("Could not release the approved category hold");
          categoryApprovalPending = false;
        } else {
          categoryApprovalPending = true;
        }
      }
    } catch (categoryError) {
      await admin.from("courses").delete().eq("id", data.id).eq("owner_id", user.id);
      console.error("course_category_hold_failed", { name: categoryError instanceof Error ? categoryError.name : "unknown" });
      return NextResponse.json({ error: "The course could not be saved with its category approval request. Apply migration 0013 and retry." }, { status: 503 });
    }
  }

  await writeAuditLog({ actorId: user.id, action: "course.created", targetType: "course", targetId: data.id, metadata: { slug: data.slug, categoryApprovalPending } });
  return NextResponse.json({ course: data, categoryApprovalPending }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
