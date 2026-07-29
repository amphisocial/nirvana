import { NextRequest, NextResponse } from "next/server";
import { config, isAdmin } from "@/lib/config";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dailyPick } from "@/lib/agents/orchestrator";
import { saveBlog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nightly "AI Analyst of the Day" run.
// - Automatic runs (scheduler) respect NIGHTLY_ENABLED.
// - A manual `force=1` run (admin, human-in-the-loop) always runs and
//   overwrites today's post — this is the "refresh the homepage now" action.
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (!config.nightly.enabled && !force) {
    return NextResponse.json({ skipped: true, reason: "NIGHTLY_ENABLED is false (use force=1 to refresh manually)" });
  }
  // Authorize: a signed-in admin (the button) OR a valid CRON_SECRET (schedulers).
  const session = await getServerSession(authOptions);
  const admin = isAdmin(session?.user?.email);
  const auth = req.headers.get("authorization") || "";
  const secret = req.nextUrl.searchParams.get("secret") || auth.replace("Bearer ", "");
  const secretOk = !config.nightly.secret || secret === config.nightly.secret;
  if (!admin && !secretOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const post = await dailyPick();
  await saveBlog(post, force);
  return NextResponse.json({ ok: true, forced: force, slug: post.slug, title: post.title, pick: post.pick.symbol, engine: post.engine });
}

// Dev-only manual GET trigger when no secret is set.
export async function GET(req: NextRequest) {
  if (config.nightly.secret) return NextResponse.json({ error: "Use POST with secret" }, { status: 405 });
  return POST(req);
}
