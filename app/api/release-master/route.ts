import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ReleaseMasterAlbum } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    credentials = JSON.parse(keyJson.replace(/\n/g, "\\n"));
  }
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function GET() {
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
    if (!rows || rows.length === 0) return NextResponse.json([]);

    const albums: ReleaseMasterAlbum[] = rows
      .filter((row) => row[0] && row[2] && row[3])
      .map((row) => ({
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
      }));

    return NextResponse.json(albums);
  } catch (error) {
    console.error("Failed to get Release Master albums:", error);
    return NextResponse.json({ error: "アルバム一覧の取得に失敗しました" }, { status: 500 });
  }
}
