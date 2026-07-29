import { NextRequest, NextResponse } from "next/server";
import { savePortfolio } from "@/lib/store";
import type { PortfolioRecord } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const { record } = (await req.json()) as { record: PortfolioRecord };
    if (!record?.id) return NextResponse.json({ error: "Invalid record" }, { status: 400 });
    await savePortfolio(record);
    return NextResponse.json({ ok: true, id: record.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
  }
}
