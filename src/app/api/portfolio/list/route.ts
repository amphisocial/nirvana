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
  return NextResponse.json({
    portfolios: all.map((p) => ({ id: p.id, createdAt: p.createdAt, amount: p.answers.amount, goal: p.answers.goal, holdings: p.allocation.holdings.length })),
  });
}
