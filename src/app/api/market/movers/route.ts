import { NextResponse } from "next/server";
import { getMovers } from "@/lib/market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const movers = await getMovers();
  return NextResponse.json(movers);
}
