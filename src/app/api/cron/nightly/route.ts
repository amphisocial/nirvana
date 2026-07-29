import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { dailyPick } from "@/lib/agents/orchestrator";
import { saveBlog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nightly "AI Analyst of the Day" run. Admin toggles it via NIGHTLY_ENABLED.
// Protect with CRON_SECRET (Authorization: Bearer <secret> or ?secret=).
export async function POST(req: NextRequest) {
  if (!config.nightly.enabled) {
    return NextResponse.json({ skipped: true, reason: "NIGHTLY_ENABLED is false" });
  }
  const auth = req.headers.get("authorization") || "";
  const secret = req.nextUrl.searchParams.get("secret") || auth.replace("Bearer ", "");
  if (config.nightly.secret && secret !== config.nightly.secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const post = await dailyPick();
  await saveBlog(post);
  return NextResponse.json({ ok: true, slug: post.slug, title: post.title, engine: post.engine });
}

// Allow manual GET trigger in dev only (no secret set).
export async function GET(req: NextRequest) {
  if (config.nightly.secret) return NextResponse.json({ error: "Use POST with secret" }, { status: 405 });
  return POST(req);
}
