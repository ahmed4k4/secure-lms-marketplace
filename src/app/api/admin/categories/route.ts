import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

const schema = z.object({ slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), nameEn: z.string().trim().min(2).max(120), nameAr: z.string().trim().min(2).max(120), sortOrder: z.number().int().min(-10000).max(10000).default(0) });
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasAdminPermission(auth.actor, "categories.manage")) return NextResponse.json({ error: "You do not have permission to manage categories." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid category slug and both localized names." }, { status: 400 });
  const { data, error } = await auth.db.from("categories").insert({ slug: parsed.data.slug, name_en: parsed.data.nameEn, name_ar: parsed.data.nameAr, sort_order: parsed.data.sortOrder }).select("id,slug,name_en,name_ar,sort_order").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This category slug already exists." }, { status: 409 });
    console.error("admin_category_create_failed", JSON.stringify({ code: error.code, message: error.message?.slice(0, 200) }));
    return NextResponse.json({ error: "Could not create category." }, { status: 500 });
  }
  await writeAuditLog({ actorId: auth.actor.id, action: "admin.category.created", targetType: "category", targetId: data.id, metadata: { slug: data.slug } });
  return NextResponse.json({ category: data }, { status: 201 });
}
