import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";
const schema = z.object({ nameEn: z.string().trim().min(2).max(120).optional(), nameAr: z.string().trim().min(2).max(120).optional(), sortOrder: z.number().int().min(-10000).max(10000).optional() }).refine((value) => Object.keys(value).length > 0);
export async function PATCH(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasAdminPermission(auth.actor, "categories.manage")) return NextResponse.json({ error: "You do not have permission to manage categories." }, { status: 403 });
  const { categoryId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)) return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = schema.safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Invalid category update" }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (parsed.data.nameEn !== undefined) update.name_en = parsed.data.nameEn;
  if (parsed.data.nameAr !== undefined) update.name_ar = parsed.data.nameAr;
  if (parsed.data.sortOrder !== undefined) update.sort_order = parsed.data.sortOrder;
  const { error } = await auth.db.from("categories").update(update).eq("id", categoryId);
  if (error) return NextResponse.json({ error: "Could not update category." }, { status: 500 });
  await writeAuditLog({ actorId: auth.actor.id, action: "admin.category.updated", targetType: "category", targetId: categoryId, metadata: update });
  return NextResponse.json({ success: true });
}
export async function DELETE(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasAdminPermission(auth.actor, "categories.manage")) return NextResponse.json({ error: "You do not have permission to manage categories." }, { status: 403 });
  const { categoryId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)) return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
  const { error } = await auth.db.from("categories").delete().eq("id", categoryId);
  if (error) return NextResponse.json({ error: "Could not delete category." }, { status: 500 });
  await writeAuditLog({ actorId: auth.actor.id, action: "admin.category.deleted", targetType: "category", targetId: categoryId });
  return NextResponse.json({ success: true });
}
