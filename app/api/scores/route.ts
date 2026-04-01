import { NextResponse } from "next/server";
import { getAllScores } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scores = await getAllScores();
    return NextResponse.json(scores);
  } catch (error) {
    console.error("Failed to get all scores:", error);
    return NextResponse.json({ error: "スコアの取得に失敗しました" }, { status: 500 });
  }
}
