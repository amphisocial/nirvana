import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  return NextResponse.json(await getQuote(symbol.toUpperCase()));
}
