import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { localRateLimit } from "@/lib/server/rate-limit";
const schema = z.object({ nameEn: z.string().trim().min(2).max(120), nameAr: z.string().trim().min(2).max(120) });
const slugify = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-+$/g, "").slice(0, 80);
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const roles = await getUserRoles(user.id); if (!roles.some((role) => ["instructor", "super_admin"].includes(role))) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
  const rate = localRateLimit(`category-request:${user.id}`, 5); if (!rate.allowed) return NextResponse.json({ error: "Too many category requests" }, { status: 429 });
  let raw: unknown; try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: "Provide category names in Arabic and English." }, { status: 400 });
  const slug = slugify(parsed.data.nameEn); if (slug.length < 2) return NextResponse.json({ error: "The English name must produce a valid category slug." }, { status: 400 });
  const { data: existing } = await db.from("categories").select("id,name_en,name_ar").ilike("slug", slug).maybeSingle();
  if (existing) return NextResponse.json({ error: "A matching category already exists. Choose it from the category list." }, { status: 409 });
  const { data, error } = await db.from("category_requests").insert({ requester_id: user.id, name_en: parsed.data.nameEn, name_ar: parsed.data.nameAr, slug }).select("id,status,slug").single();
  if (error) { console.error("category_request_failed", { code: error.code }); return NextResponse.json({ error: error.code === "23505" ? "You already submitted this category." : "Could not submit category request. Apply migration 0012 first." }, { status: error.code === "23505" ? 409 : 503 }); }
  return NextResponse.json({ request: data, message: "Category request submitted for admin review." }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
