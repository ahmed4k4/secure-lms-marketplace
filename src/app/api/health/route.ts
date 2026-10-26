import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyDatabaseIssue } from "@/lib/server/database-errors";
export const dynamic = "force-dynamic";
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ status: "degraded", service: "lms-web", database: "missing_configuration", missing: [!url ? "NEXT_PUBLIC_SUPABASE_URL" : null, !key ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null].filter(Boolean) }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("courses").select("id", { head: true, count: "exact" }).limit(1);
    if (error) {
      const issue = classifyDatabaseIssue(error);
      console.error("database_health_check_failed", { issue, code: error.code ?? "unknown", status: 0 });
      return NextResponse.json({ status: "degraded", service: "lms-web", database: issue }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ status: "ok", service: "lms-web", database: "connected", catalog: "queryable", timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const issue = classifyDatabaseIssue(error);
    console.error("database_health_check_exception", { issue, name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ status: "degraded", service: "lms-web", database: issue }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
