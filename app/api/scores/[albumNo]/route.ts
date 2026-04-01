import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getScoresForAlbum, addScore, hasScore, initScoresSheet, updateScore } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { albumNo: string } }
) {
  try {
    const scores = await getScoresForAlbum(params.albumNo);
    const averageScore =
      scores.length > 0
        ? Math.round((scores.reduce((sum, s) => sum + s.score, 0) / scores.length) * 10) / 10
        : null;

    return NextResponse.json({ scores, averageScore });
  } catch (error) {
    console.error("Failed to get scores:", error);
    return NextResponse.json({ error: "スコアの取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { albumNo: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.name) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const memberName = session.user.name.trim();

    const body = await request.json();
    const { score, comment } = body as { score: number; comment: string };

    if (score === undefined || score === null || typeof score !== "number") {
      return NextResponse.json({ error: "スコアを入力してください" }, { status: 400 });
    }
    if (score < 0 || score > 10) {
      return NextResponse.json({ error: "スコアは0〜10の範囲で入力してください" }, { status: 400 });
    }
    if ((score * 2) % 1 !== 0) {
      return NextResponse.json({ error: "スコアは0.5刻みで入力してください" }, { status: 400 });
    }

    await initScoresSheet();

    const alreadyScored = await hasScore(params.albumNo, memberName);
    if (alreadyScored) {
      return NextResponse.json({ error: "すでにレビューを投稿済みです" }, { status: 409 });
    }

    const newScore = await addScore({
      reviewId: params.albumNo,
      memberName,
      score,
      comment: (comment || "").trim(),
    });

    return NextResponse.json(newScore, { status: 201 });
  } catch (error) {
    console.error("Failed to add score:", error);
    return NextResponse.json({ error: "レビューの投稿に失敗しました" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { albumNo: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.name) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const memberName = session.user.name.trim();

    const body = await request.json();
    const { score, comment } = body as { score: number; comment: string };

    if (score === undefined || score === null || typeof score !== "number") {
      return NextResponse.json({ error: "スコアを入力してください" }, { status: 400 });
    }
    if (score < 0 || score > 10) {
      return NextResponse.json({ error: "スコアは0〜10の範囲で入力してください" }, { status: 400 });
    }
    if ((score * 2) % 1 !== 0) {
      return NextResponse.json({ error: "スコアは0.5刻みで入力してください" }, { status: 400 });
    }

    const updated = await updateScore(params.albumNo, memberName, score, (comment || "").trim());
    if (!updated) {
      return NextResponse.json({ error: "レビューが見つかりません" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update score:", error);
    return NextResponse.json({ error: "レビューの更新に失敗しました" }, { status: 500 });
  }
}
