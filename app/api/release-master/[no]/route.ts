import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { ReleaseMasterAlbum } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  const credentials = JSON.parse(keyJson);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { no: string } }
) {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A2:AC",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const row = rows.find((r) => r[0] === params.no && r[2] && r[3]);
    if (!row) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const album: ReleaseMasterAlbum = {
      no: row[0] || "",
      date: row[1] || "",
      title: row[2] || "",
      artist: row[3] || "",
      genre: (row[5] || "") as ReleaseMasterAlbum["genre"],
      mjAdoption: row[16] || "",
      legacyScores: LEGACY_MEMBERS
        .map((name, i) => ({ name, value: row[21 + i] || "" }))
        .filter((s) => s.value !== ""),
      spotifyUrl: row[27] || "",
      coverUrl: row[28] || "",
    };

    return NextResponse.json(album);
  } catch (error) {
    console.error("Failed to get album from Release Master:", error);
    return NextResponse.json({ error: "アルバムの取得に失敗しました" }, { status: 500 });
  }
}
