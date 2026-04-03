import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAllRecommendations, getRecommendationsForUser, addRecommendation, initRecommendationsSheet } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const forUser = searchParams.get("forUser");

    if (forUser === "me") {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
      const recs = await getRecommendationsForUser(session.user.email.toLowerCase());
      return NextResponse.json(recs);
    }

    const albumNo = searchParams.get("albumNo");
    const recommendations = await getAllRecommendations();
    if (albumNo) {
      return NextResponse.json(recommendations.filter((r) => r.albumNo === albumNo));
    }
    return NextResponse.json(recommendations);
  } catch (error) {
    console.error("Failed to get recommendations:", error);
    return NextResponse.json({ error: "レコメンドの取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const body = await request.json();
    const { albumNo, albumTitle, artistName, coverUrl, message, mentionedEmails } = body as {
      albumNo: string;
      albumTitle: string;
      artistName: string;
      coverUrl: string;
      message: string;
      mentionedEmails: string[];
    };

    if (!albumTitle) {
      return NextResponse.json({ error: "アルバム情報が不足しています" }, { status: 400 });
    }

    await initRecommendationsSheet();

    const rec = await addRecommendation({
      recommenderId: session.user.email.toLowerCase(),
      albumNo: albumNo || "",
      albumTitle,
      artistName,
      coverUrl: coverUrl || "",
      message: message || "",
      mentionedEmails: Array.isArray(mentionedEmails) ? mentionedEmails.map((e) => e.toLowerCase()) : [],
    });

    return NextResponse.json(rec, { status: 201 });
  } catch (error) {
    console.error("Failed to add recommendation:", error);
    return NextResponse.json({ error: "レコメンドの投稿に失敗しました" }, { status: 500 });
  }
}
