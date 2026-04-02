import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBookmarks, addBookmark, removeBookmark } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    const bookmarks = await getBookmarks(session.user.email.toLowerCase());
    return NextResponse.json(bookmarks);
  } catch (error) {
    console.error("Failed to get bookmarks:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    const { albumNo } = await request.json() as { albumNo: string };
    if (!albumNo) return NextResponse.json({ error: "albumNoが必要です" }, { status: 400 });
    await addBookmark(session.user.email.toLowerCase(), albumNo);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to add bookmark:", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    const { albumNo } = await request.json() as { albumNo: string };
    if (!albumNo) return NextResponse.json({ error: "albumNoが必要です" }, { status: 400 });
    await removeBookmark(session.user.email.toLowerCase(), albumNo);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to remove bookmark:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
