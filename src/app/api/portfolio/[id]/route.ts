import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rec = await getPortfolio(params.id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ record: rec });
}
