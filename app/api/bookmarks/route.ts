import { NextRequest, NextResponse } from "next/server";
import { guardMember } from "@/lib/member-auth";
import { getBookmarks, addBookmark, removeBookmark } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const gate = await guardMember(request);
    if (!gate.ok) return gate.response;
    const bookmarks = await getBookmarks(gate.email);
    return NextResponse.json(bookmarks);
  } catch (error) {
    console.error("Failed to get bookmarks:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await guardMember(request);
    if (!gate.ok) return gate.response;
    const { albumTitle, artistName, albumUid } = await request.json() as { albumTitle: string; artistName: string; albumUid?: string };
    if (!albumTitle || !artistName) return NextResponse.json({ error: "albumTitleとartistNameが必要です" }, { status: 400 });
    await addBookmark(gate.email, albumTitle, artistName, albumUid);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to add bookmark:", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gate = await guardMember(request);
    if (!gate.ok) return gate.response;
    const { albumTitle, artistName, albumUid } = await request.json() as { albumTitle: string; artistName: string; albumUid?: string };
    if (!albumTitle || !artistName) return NextResponse.json({ error: "albumTitleとartistNameが必要です" }, { status: 400 });
    await removeBookmark(gate.email, albumTitle, artistName, albumUid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to remove bookmark:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
