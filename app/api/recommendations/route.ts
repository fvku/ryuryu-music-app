import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAllRecommendations, addRecommendation, initRecommendationsSheet } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const recommendations = await getAllRecommendations();
    return NextResponse.json(recommendations);
  } catch (error) {
    console.error("Failed to get recommendations:", error);
    return NextResponse.json({ error: "レコメンドの取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.name) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const body = await request.json();
    const { albumNo, albumTitle, artistName, coverUrl, message } = body as {
      albumNo: string;
      albumTitle: string;
      artistName: string;
      coverUrl: string;
      message: string;
    };

    if (!albumNo || !albumTitle) {
      return NextResponse.json({ error: "アルバム情報が不足しています" }, { status: 400 });
    }

    await initRecommendationsSheet();

    const rec = await addRecommendation({
      recommenderId: session.user.name.trim(),
      albumNo,
      albumTitle,
      artistName,
      coverUrl: coverUrl || "",
      message: message || "",
    });

    return NextResponse.json(rec, { status: 201 });
  } catch (error) {
    console.error("Failed to add recommendation:", error);
    return NextResponse.json({ error: "レコメンドの投稿に失敗しました" }, { status: 500 });
  }
}
