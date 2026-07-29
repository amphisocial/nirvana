import { NextRequest, NextResponse } from "next/server";
import { runFirm } from "@/lib/agents/orchestrator";
import { savePortfolio } from "@/lib/store";
import type { Answers, PortfolioRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { answers, save } = (await req.json()) as { answers: Answers; save?: boolean };
    if (!answers?.amount) return NextResponse.json({ error: "Missing amount" }, { status: 400 });
    const result = await runFirm(answers);
    const id = Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    const record: PortfolioRecord = {
      id,
      createdAt: new Date().toISOString(),
      answers,
      allocation: result.allocation,
      backtest: result.backtest,
      research: result.research,
      risk: result.risk,
      debate: result.debate,
      updates: [],
      engine: result.engine,
    };
    if (save) await savePortfolio(record);
    return NextResponse.json({ record, saved: Boolean(save) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
  }
}
