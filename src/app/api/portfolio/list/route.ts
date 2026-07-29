import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listPortfoliosByUser } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ portfolios: [] });
  const all = await listPortfoliosByUser(email);
  const portfolios = all.map((p) => {
    const invested = p.allocation.holdings.reduce((a, h) => a + h.dollars, 0);
    const latest = p.updates?.[0];
    return {
      id: p.id,
      createdAt: p.createdAt,
      goal: p.answers.goal,
      horizon: p.answers.horizon,
      risk: p.answers.riskComfort,
      amount: p.answers.amount,
      invested,
      holdings: p.allocation.holdings.length,
      topNames: p.allocation.holdings.slice(0, 4).map((h) => h.symbol),
      baseValue: latest?.baseValue ?? invested,
      currentValue: latest?.currentValue ?? null,
      gainLossPct: latest?.gainLossPct ?? null,
      updatedAt: latest?.at ?? null,
      engine: p.engine,
    };
  });
  return NextResponse.json({ portfolios });
}
