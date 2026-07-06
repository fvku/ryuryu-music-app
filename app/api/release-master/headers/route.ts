import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

/** スプレッドシートの実際のヘッダー行を返す（列名の確認用） */
export async function GET() {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!1:1",
    });

    const headerRow = response.data.values?.[0] ?? [];
    const indexed = headerRow.map((name: string, i: number) => ({
      index: i,
      column: indexToColumnLetter(i),
      name: name ?? "",
    }));

    return NextResponse.json(indexed);
  } catch (error) {
    console.error("Failed to get headers:", error);
    return NextResponse.json({ error: "ヘッダーの取得に失敗しました" }, { status: 500 });
  }
}

function indexToColumnLetter(index: number): string {
  if (index < 26) return String.fromCharCode(index + 65);
  return String.fromCharCode(Math.floor(index / 26) + 64) + String.fromCharCode((index % 26) + 65);
}
