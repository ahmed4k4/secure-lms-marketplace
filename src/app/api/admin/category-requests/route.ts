import { NextResponse } from "next/server";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasAdminPermission(auth.actor, "categories.manage")) return NextResponse.json({ error: "Category management permission required" }, { status: 403 });
  const url = new URL(request.url); const status = url.searchParams.get("status") ?? "pending";
  if (!["pending", "approved", "rejected", "all"].includes(status)) return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  let query = auth.db.from("category_requests").select("id,requester_id,name_en,name_ar,slug,status,reviewed_by,reviewed_at,category_id,created_at").order("created_at", { ascending: false }).limit(100);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) { console.error("admin_category_requests_read_failed", { code: error.code }); return NextResponse.json({ error: "Could not load category requests. Apply migration 0012." }, { status: 503 }); }
  return NextResponse.json({ requests: data ?? [] }, { headers: { "Cache-Control": "no-store, private" } });
}
