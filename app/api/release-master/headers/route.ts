import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try {
    const decoded = Buffer.from(keyJson, "base64").toString("utf-8");
    credentials = JSON.parse(decoded);
  } catch {
    try {
      credentials = JSON.parse(keyJson);
    } catch {
      credentials = JSON.parse(keyJson.replace(/\n/g, "\\n"));
    }
  }
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

/** スプレッドシートの実際のヘッダー行を返す（列名の確認用） */
export async function GET() {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
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
