import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legacy endpoint retained to return a clear migration error; video storage is private R2. */
export async function POST(request: Request) {
  return NextResponse.json(
    { error: "Cloudflare Stream is no longer used by this installation. Upload and play videos through the private R2 workflow." },
    { status: 410, headers: { "Cache-Control": "no-store, private" } },
  );
}
