import { NextRequest, NextResponse } from "next/server";
import { runSingleAgent } from "@/lib/agents/orchestrator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const { agentId, symbol, answers } = await req.json();
    if (!agentId || !symbol) return NextResponse.json({ error: "Need agentId and symbol" }, { status: 400 });
    const out = await runSingleAgent(agentId, String(symbol).toUpperCase(), answers);
    return NextResponse.json({ result: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
  }
}
