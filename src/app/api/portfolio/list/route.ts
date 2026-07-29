import { NextResponse } from "next/server";
import { listPortfolios } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const all = await listPortfolios();
  return NextResponse.json({ portfolios: all.map((p) => ({ id: p.id, createdAt: p.createdAt, amount: p.answers.amount, goal: p.answers.goal, holdings: p.allocation.holdings.length })) });
}
