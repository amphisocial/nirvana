import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { savePortfolio } from "@/lib/store";
import type { PortfolioRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Saving is the one gated action — you must be signed in with Google.
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Sign in to save a portfolio." }, { status: 401 });
  }
  try {
    const { record } = (await req.json()) as { record: PortfolioRecord };
    if (!record?.id) return NextResponse.json({ error: "Invalid record" }, { status: 400 });
    record.userEmail = email; // ownership
    await savePortfolio(record);
    return NextResponse.json({ ok: true, id: record.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
  }
}
