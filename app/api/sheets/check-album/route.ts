import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getWriteAuth } from "@/lib/release-master";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const spotifyId = searchParams.get("spotifyId");
  if (!spotifyId) {
    return NextResponse.json({ error: "spotifyId is required" }, { status: 400 });
  }

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return NextResponse.json({ exists: false });
  }

  try {
    const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

    // Read header row to find Spotify URL column dynamically
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!1:1",
    });
    const col = buildHeaderMap(headerRes.data.values?.[0] ?? []);
    const spotifyColIdx = col[SHEET_COL.SPOTIFY_URL];
    if (spotifyColIdx === undefined) {
      return NextResponse.json({ error: `COLUMN_NOT_FOUND: ${SHEET_COL.SPOTIFY_URL}` }, { status: 500 });
    }
    const spotifyColLetter = indexToColumnLetter(spotifyColIdx);

    // Read Spotify URL column and A column (No.) together
    const [noRes, urlRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!A2:A",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'Release Master'!${spotifyColLetter}2:${spotifyColLetter}`,
      }),
    ]);

    const noRows = noRes.data.values ?? [];
    const urlRows = urlRes.data.values ?? [];

    for (let i = 0; i < urlRows.length; i++) {
      const url = (urlRows[i]?.[0] ?? "") as string;
      if (url.includes(spotifyId)) {
        const no = (noRows[i]?.[0] ?? "") as string;
        return NextResponse.json({ exists: true, no });
      }
    }

    return NextResponse.json({ exists: false });
  } catch (error) {
    console.error("check-album failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
