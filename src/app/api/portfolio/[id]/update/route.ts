import { NextResponse } from "next/server";
import { getPortfolio, savePortfolio } from "@/lib/store";
import { refreshPerformance } from "@/lib/agents/updater";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const rec = await getPortfolio(params.id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const snap = await refreshPerformance(rec);
  rec.updates = [snap, ...rec.updates].slice(0, 60);
  await savePortfolio(rec);
  return NextResponse.json({ snapshot: snap });
}
