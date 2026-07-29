import { NextResponse } from "next/server";
import { getNews } from "@/lib/market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const news = await getNews(3);
  return NextResponse.json({ news });
}
