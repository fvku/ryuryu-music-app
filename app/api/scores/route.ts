import { NextResponse } from "next/server";
import { getAllScores } from "@/lib/sheets";
import { cached, CACHE_KEY, CACHE_TTL } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scores = await cached(CACHE_KEY.SCORES, CACHE_TTL.SCORES, getAllScores);
    return NextResponse.json(scores);
  } catch (error) {
    console.error("Failed to get all scores:", error);
    return NextResponse.json({ error: "スコアの取得に失敗しました" }, { status: 500 });
  }
}
