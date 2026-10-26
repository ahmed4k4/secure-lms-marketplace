import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 }); const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) await writeAuditLog({ actorId: user.id, action: "auth.signed_out", targetType: "profile", targetId: user.id }); await supabase.auth.signOut(); const url = new URL(request.url); const locale = url.searchParams.get("locale") === "en" ? "en" : "ar"; return NextResponse.redirect(new URL(`/${locale}/sign-in`, url.origin), 303); }
