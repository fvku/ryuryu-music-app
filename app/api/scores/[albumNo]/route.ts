import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getScoresForAlbum, addScore, hasScore, initScoresSheet, updateScore } from "@/lib/sheets";
import { getMemberShortName } from "@/lib/members";
import { writeScoreToReleaseMaster } from "@/lib/release-master";
import { LEGACY_NAME_TO_EMAIL } from "@/lib/members";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { albumNo: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const albumTitle = searchParams.get("title") ?? "";
    const artistName = searchParams.get("artist") ?? "";
    const scores = await getScoresForAlbum(albumTitle, artistName);
    const scoredScores = scores.filter((s) => s.score !== null);
    const averageScore =
      scoredScores.length > 0
        ? Math.round((scoredScores.reduce((sum, s) => sum + s.score!, 0) / scoredScores.length) * 10) / 10
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
    if (!session?.user?.email) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    // email を正規識別子として保存。旧名前エントリとの照合に altNames を使用
    const memberName = session.user.email.toLowerCase();
    const shortName = getMemberShortName(memberName);
    const altNames = Object.entries(LEGACY_NAME_TO_EMAIL)
      .filter(([, email]) => email === memberName)
      .map(([name]) => name);

    const body = await request.json();
    const { score, comment, albumTitle: _albumTitle, artistName: _artistName } = body as { score: number | null; comment: string; albumTitle?: string; artistName?: string };
    const albumTitle = _albumTitle ?? "";
    const artistName = _artistName ?? "";

    if (score !== null && score !== undefined) {
      if (typeof score !== "number" || score < 0 || score > 10) {
        return NextResponse.json({ error: "スコアは0〜10の範囲で入力してください" }, { status: 400 });
      }
      if ((score * 2) % 1 !== 0) {
        return NextResponse.json({ error: "スコアは0.5刻みで入力してください" }, { status: 400 });
      }
    }

    await initScoresSheet();

    const alreadyScored = await hasScore(albumTitle, artistName, memberName, altNames);
    if (alreadyScored) {
      return NextResponse.json({ error: "すでにレビューを投稿済みです" }, { status: 409 });
    }

    const trimmedComment = (comment || "").trim();
    const newScore = await addScore({
      reviewId: params.albumNo,
      memberName,
      score: score ?? null,
      comment: trimmedComment,
      albumTitle: albumTitle || "",
      artistName: artistName || "",
    });

    if (shortName && score !== null && score !== undefined) {
      writeScoreToReleaseMaster(albumTitle || "", artistName || "", shortName, score, trimmedComment).catch((e) =>
        console.error("Failed to write score to Release Master:", e)
      );
    }

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
    if (!session?.user?.email) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const memberName = session.user.email.toLowerCase();
    const shortName = getMemberShortName(memberName);
    const altNames = Object.entries(LEGACY_NAME_TO_EMAIL)
      .filter(([, email]) => email === memberName)
      .map(([name]) => name);

    const body = await request.json();
    const { score, comment, albumTitle, artistName } = body as { score: number | null; comment: string; albumTitle?: string; artistName?: string };

    if (score !== null && score !== undefined) {
      if (typeof score !== "number" || score < 0 || score > 10) {
        return NextResponse.json({ error: "スコアは0〜10の範囲で入力してください" }, { status: 400 });
      }
      if ((score * 2) % 1 !== 0) {
        return NextResponse.json({ error: "スコアは0.5刻みで入力してください" }, { status: 400 });
      }
    }

    const trimmedComment = (comment || "").trim();
    const updated = await updateScore(albumTitle || "", artistName || "", memberName, score ?? null, trimmedComment, altNames);
    if (!updated) {
      return NextResponse.json({ error: "レビューが見つかりません" }, { status: 404 });
    }

    if (shortName && score !== null && score !== undefined) {
      writeScoreToReleaseMaster(albumTitle || "", artistName || "", shortName, score, trimmedComment).catch((e) =>
        console.error("Failed to write score to Release Master:", e)
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update score:", error);
    return NextResponse.json({ error: "レビューの更新に失敗しました" }, { status: 500 });
  }
}
