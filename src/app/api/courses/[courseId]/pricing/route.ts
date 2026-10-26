import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { localRateLimit } from "@/lib/server/rate-limit";
import { writeAuditLog } from "@/lib/server/audit";

export const dynamic = "force-dynamic";
const uuid = z.string().uuid();
const planSchema = z.object({
  planId: uuid.optional(), nameEn: z.string().trim().min(2).max(100), nameAr: z.string().trim().min(2).max(100),
  currency: z.enum(["EGP", "USD", "SAR", "AED", "EUR"]), amount: z.number().finite().min(0).max(10_000_000),
  billingPeriod: z.enum(["one_time", "monthly", "yearly"]), accessDuration: z.enum(["lifetime", "fixed_days", "subscription_period"]), accessDays: z.number().int().min(1).max(3650).optional(), trialDays: z.number().int().min(0).max(90).default(0), isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.accessDuration === "fixed_days" && !value.accessDays) ctx.addIssue({ code: "custom", path: ["accessDays"], message: "Access days are required" });
  if (value.accessDuration !== "fixed_days" && value.accessDays !== undefined) ctx.addIssue({ code: "custom", path: ["accessDays"], message: "Access days are only used for fixed-day access" });
  if (value.billingPeriod !== "one_time" && value.accessDuration !== "subscription_period") ctx.addIssue({ code: "custom", path: ["accessDuration"], message: "Recurring plans must follow the subscription period" });
  if (value.billingPeriod === "one_time" && value.accessDuration === "subscription_period") ctx.addIssue({ code: "custom", path: ["accessDuration"], message: "One-time plans cannot use subscription-period access" });
  if (value.amount === 0 && (value.billingPeriod !== "one_time" || value.accessDuration !== "lifetime")) ctx.addIssue({ code: "custom", path: ["amount"], message: "Free access must be a one-time lifetime plan" });
});

async function getContext(courseId: string) {
  if (!uuid.safeParse(courseId).success) return { error: NextResponse.json({ error: "Invalid course ID" }, { status: 400 }) } as const;
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) } as const;
  if (!(await isAccountActive(user.id))) return { error: NextResponse.json({ error: "Active account required" }, { status: 403 }) } as const;
  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => ["instructor", "admin", "super_admin"].includes(role))) return { error: NextResponse.json({ error: "Instructor role required" }, { status: 403 }) } as const;
  const db = createAdminClient();
  const { data: course, error } = await db.from("courses").select("id,owner_id,title_en,title_ar").eq("id", courseId).maybeSingle();
  if (error || !course) return { error: NextResponse.json({ error: "Course not found" }, { status: 404 }) } as const;
  let canManage = course.owner_id === user.id || roles.includes("super_admin");
  if (!canManage && roles.includes("admin")) {
    const { data: delegated } = await db.from("user_permissions").select("permission_key").eq("user_id", user.id).eq("permission_key", "courses.manage_pricing").maybeSingle();
    canManage = Boolean(delegated);
  }
  if (!canManage) return { error: NextResponse.json({ error: "Course owner access required or pricing permission is missing" }, { status: 403 }) } as const;
  return { user, roles, db, course } as const;
}

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const context = await getContext(courseId);
  if ("error" in context) return context.error;
  const { data: product, error: productError } = await context.db.from("products").select("id").eq("course_id", courseId).eq("kind", "course").maybeSingle();
  if (productError) return NextResponse.json({ error: "Could not load pricing plans" }, { status: 503 });
  if (!product) return NextResponse.json({ plans: [] }, { headers: { "Cache-Control": "no-store, private" } });
  const { data: plans, error } = await context.db.from("pricing_plans").select("id,product_id,name_en,name_ar,currency,amount_minor,billing_period,access_duration,access_days,trial_days,is_active,created_at").eq("product_id", product.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load pricing plans" }, { status: 503 });
  return NextResponse.json({ plans: (plans ?? []).map((plan) => ({ ...plan, amount: Number(plan.amount_minor) / 100 })) }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const { courseId } = await params;
  const context = await getContext(courseId);
  if ("error" in context) return context.error;
  const rate = localRateLimit(`course-pricing:${context.user.id}`, 20);
  if (!rate.allowed) return NextResponse.json({ error: "Too many pricing changes. Try again shortly." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Review the pricing fields", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });
  const value = parsed.data;
  let productId: string;
  const { data: existingProduct, error: productLookupError } = await context.db.from("products").select("id,owner_id").eq("course_id", courseId).eq("kind", "course").maybeSingle();
  if (productLookupError) return NextResponse.json({ error: "Could not access course pricing" }, { status: 503 });
  if (existingProduct) {
    if (existingProduct.owner_id !== context.course.owner_id) return NextResponse.json({ error: "Pricing product ownership mismatch" }, { status: 409 });
    productId = existingProduct.id;
  } else {
    const { data: product, error } = await context.db.from("products").insert({ kind: "course", owner_id: context.course.owner_id, course_id: courseId, title_en: context.course.title_en, title_ar: context.course.title_ar, is_active: true }).select("id").single();
    if (error || !product) return NextResponse.json({ error: "Could not initialize course pricing" }, { status: 503 });
    productId = product.id;
  }
  const payload = { product_id: productId, name_en: value.nameEn, name_ar: value.nameAr, currency: value.currency, amount_minor: Math.round(value.amount * 100), billing_period: value.billingPeriod, access_duration: value.accessDuration, access_days: value.accessDuration === "fixed_days" ? value.accessDays : null, trial_days: value.trialDays, is_active: value.isActive };
  if (value.planId) {
    const { data: ownedPlan } = await context.db.from("pricing_plans").select("id,product_id").eq("id", value.planId).maybeSingle();
    if (!ownedPlan || ownedPlan.product_id !== productId) return NextResponse.json({ error: "Pricing plan not found for this course" }, { status: 404 });
    const { data: plan, error } = await context.db.from("pricing_plans").update(payload).eq("id", value.planId).select("id").single();
    if (error || !plan) return NextResponse.json({ error: "Could not update pricing plan" }, { status: 503 });
    await writeAuditLog({ actorId: context.user.id, action: "course.pricing.updated", targetType: "pricing_plan", targetId: plan.id, metadata: { courseId, currency: value.currency, amountMinor: payload.amount_minor, billingPeriod: value.billingPeriod } });
    return NextResponse.json({ success: true, planId: plan.id }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data: plan, error } = await context.db.from("pricing_plans").insert(payload).select("id").single();
  if (error || !plan) return NextResponse.json({ error: "Could not create pricing plan" }, { status: 503 });
  await writeAuditLog({ actorId: context.user.id, action: "course.pricing.created", targetType: "pricing_plan", targetId: plan.id, metadata: { courseId, currency: value.currency, amountMinor: payload.amount_minor, billingPeriod: value.billingPeriod } });
  return NextResponse.json({ success: true, planId: plan.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const { courseId } = await params;
  const context = await getContext(courseId);
  if ("error" in context) return context.error;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = z.object({ planId: uuid }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid pricing plan ID" }, { status: 400 });
  const { data: product } = await context.db.from("products").select("id").eq("course_id", courseId).eq("kind", "course").maybeSingle();
  if (!product) return NextResponse.json({ error: "Pricing product not found" }, { status: 404 });
  const { data: plan, error } = await context.db.from("pricing_plans").update({ is_active: false }).eq("id", parsed.data.planId).eq("product_id", product.id).select("id").maybeSingle();
  if (error || !plan) return NextResponse.json({ error: "Pricing plan not found" }, { status: 404 });
  await writeAuditLog({ actorId: context.user.id, action: "course.pricing.deactivated", targetType: "pricing_plan", targetId: plan.id, metadata: { courseId } });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
