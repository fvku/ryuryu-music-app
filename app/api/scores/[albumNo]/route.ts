import { NextRequest, NextResponse } from "next/server";
import { guardMember } from "@/lib/member-auth";
import { getScoresForAlbum, addScore, findScoreByRequestId, hasScore, initScoresSheet, updateScore } from "@/lib/sheets";
import { getMemberShortName } from "@/lib/members";
import { writeScoreToReleaseMaster } from "@/lib/release-master";
import { LEGACY_NAME_TO_EMAIL } from "@/lib/members";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";

const RM_WARNING = "アプリには保存しましたが、Release Masterへの反映に失敗しました";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const gate = await guardMember();
    if (!gate.ok) return gate.response;
    const { searchParams } = new URL(request.url);
    const albumTitle = searchParams.get("title") ?? "";
    const artistName = searchParams.get("artist") ?? "";
    const albumUid = searchParams.get("uid") ?? undefined;
    const scores = await getScoresForAlbum(albumTitle, artistName, albumUid);
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
  { params }: { params: Promise<{ albumNo: string }> }
) {
  try {
    const gate = await guardMember(request);
    if (!gate.ok) return gate.response;

    // email を正規識別子として保存。旧名前エントリとの照合に altNames を使用
    const memberName = gate.email;
    const shortName = getMemberShortName(memberName);
    const altNames = Object.entries(LEGACY_NAME_TO_EMAIL)
      .filter(([, email]) => email === memberName)
      .map(([name]) => name);

    const body = await request.json();
    const { score, comment, albumTitle: _albumTitle, artistName: _artistName, albumUid, requestId: _requestId } = body as { score: number | null; comment: string; albumTitle?: string; artistName?: string; albumUid?: string; requestId?: string };
    // 同じ投稿の再送（通信が切れて結果が分からなかった場合など）を二重登録しないための操作ID
    const requestId = typeof _requestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(_requestId) ? _requestId : "";
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

    if ((score === null || score === undefined) && !(typeof comment === "string" && comment.trim())) {
      return NextResponse.json({ error: "スコアかコメントのどちらかを入れてください" }, { status: 400 });
    }

    await initScoresSheet();

    if (requestId) {
      const sent = await findScoreByRequestId(requestId);
      if (sent) return NextResponse.json({ ...sent, duplicate: true }, { status: 200 });
    }

    const alreadyScored = await hasScore(albumTitle, artistName, memberName, altNames, albumUid);
    if (alreadyScored) {
      return NextResponse.json({ error: "すでにレビューを投稿済みです" }, { status: 409 });
    }

    const trimmedComment = (comment || "").trim();

    // 書き込み直前に再チェック（並行リクエストによる二重投稿を防ぐ）
    const doubleCheck = await hasScore(albumTitle, artistName, memberName, altNames, albumUid);
    if (doubleCheck) {
      return NextResponse.json({ error: "すでにレビューを投稿済みです" }, { status: 409 });
    }

    const newScore = await addScore({
      reviewId: (await params).albumNo,
      memberName,
      score: score ?? null,
      comment: trimmedComment,
      albumTitle: albumTitle || "",
      artistName: artistName || "",
      albumUid: albumUid || "",
      requestId,
    });
    invalidateCache(CACHE_KEY.SCORES);

    // コメントだけの投稿は Release Master に書かない（従来の仕様）
    if (shortName && score !== null && score !== undefined) {
      try {
        await writeScoreToReleaseMaster(albumTitle || "", artistName || "", shortName, score, trimmedComment, albumUid, {
          memberEmail: memberName, operationId: requestId || `post-${newScore.submittedAt}`, recordedAt: newScore.submittedAt,
        });
      } catch (e) {
        console.error("Failed to write score to Release Master:", e);
        // アプリへの保存は成功している。画面で部分成功を伝え、更新（PUT）で安全に再送できるようにする
        invalidateCache(CACHE_KEY.SCORES, CACHE_KEY.RELEASE_MASTER);
        return NextResponse.json({ ...newScore, warning: RM_WARNING, rmPending: true }, { status: 201 });
      }
    }
    // 書き込みが終わってから無効化する（途中の読み取りが古い内容を保存し直さないように）
    invalidateCache(CACHE_KEY.SCORES, CACHE_KEY.RELEASE_MASTER);

    return NextResponse.json(newScore, { status: 201 });
  } catch (error) {
    console.error("Failed to add score:", error);
    return NextResponse.json({ error: "レビューの投稿に失敗しました" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const gate = await guardMember(request);
    if (!gate.ok) return gate.response;

    const memberName = gate.email;
    const shortName = getMemberShortName(memberName);
    const altNames = Object.entries(LEGACY_NAME_TO_EMAIL)
      .filter(([, email]) => email === memberName)
      .map(([name]) => name);

    const body = await request.json();
    const { score, comment, albumTitle, artistName, albumUid } = body as { score: number | null; comment: string; albumTitle?: string; artistName?: string; albumUid?: string };

    if (score !== null && score !== undefined) {
      if (typeof score !== "number" || score < 0 || score > 10) {
        return NextResponse.json({ error: "スコアは0〜10の範囲で入力してください" }, { status: 400 });
      }
      if ((score * 2) % 1 !== 0) {
        return NextResponse.json({ error: "スコアは0.5刻みで入力してください" }, { status: 400 });
      }
    }

    const trimmedComment = (comment || "").trim();
    const updated = await updateScore(albumTitle || "", artistName || "", memberName, score ?? null, trimmedComment, altNames, undefined, albumUid);
    if (!updated) {
      return NextResponse.json({ error: "レビューが見つかりません" }, { status: 404 });
    }
    invalidateCache(CACHE_KEY.SCORES);

    // スコアを「なし」にした場合も Release Master を揃える（古い点数が平均に残らないように）。
    // 元々空のセルにスコアなしは書かない（writeScoreToReleaseMaster 側で判定）
    if (shortName) {
      try {
        await writeScoreToReleaseMaster(albumTitle || "", artistName || "", shortName, score ?? null, trimmedComment, albumUid, {
          memberEmail: memberName, operationId: `put-${updated.submittedAt}`, recordedAt: updated.submittedAt,
        });
      } catch (e) {
        console.error("Failed to write score to Release Master:", e);
        invalidateCache(CACHE_KEY.SCORES, CACHE_KEY.RELEASE_MASTER);
        return NextResponse.json({ ...updated, warning: RM_WARNING, rmPending: true });
      }
    }
    invalidateCache(CACHE_KEY.SCORES, CACHE_KEY.RELEASE_MASTER);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update score:", error);
    return NextResponse.json({ error: "レビューの更新に失敗しました" }, { status: 500 });
  }
}
