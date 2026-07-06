import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { searchAlbums } from "@/lib/spotify";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { getGoogleAuth } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function norm(s: string) { return s.trim().toLowerCase(); }

function stripTypePrefix(s: string) {
  return s.replace(/^\[(EP|Single|single|ep|Album|album|Compilation|compilation)\]\s*/i, "").trim();
}

function titleMatch(sheetTitle: string, spotifyTitle: string): boolean {
  if (norm(sheetTitle) === norm(spotifyTitle)) return true;
  return norm(stripTypePrefix(sheetTitle)) === norm(stripTypePrefix(spotifyTitle));
}

function normArtist(s: string) { return norm(s).replace(/\s*&\s*/g, ", "); }

function artistMatch(sheetArtist: string, spotifyArtist: string): boolean {
  const a = normArtist(sheetArtist);
  const b = normArtist(spotifyArtist);
  if (a === b) return true;
  return b.includes(a) || a.includes(b);
}

export interface RefetchMismatch {
  rowNum: number;
  sheetTitle: string;
  sheetArtist: string;
  spotifyTitle: string;
  spotifyArtist: string;
  spotifyUrl: string;
}

export async function POST(req: NextRequest) {
  const { adminPassword, limit = 30 } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) return NextResponse.json({ error: "データが見つかりません" }, { status: 404 });

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];
  const coverIdx   = col[SHEET_COL.COVER_URL];
  const titleIdx   = col["アルバム名"]   ?? 2;
  const artistIdx  = col["アーティスト"] ?? 3;

  if (spotifyIdx === undefined) return NextResponse.json({ error: "Spotify列が見つかりません" }, { status: 422 });

  const cSpotify = indexToColumnLetter(spotifyIdx);
  const cCover   = coverIdx !== undefined ? indexToColumnLetter(coverIdx) : null;

  // Spotify URLが空の行を抽出（上限あり）
  const targets = dataRows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => !(row[spotifyIdx] ?? "").trim())
    .filter(({ row }) => (row[titleIdx] ?? "").trim() || (row[artistIdx] ?? "").trim())
    .slice(0, limit);

  const totalEmpty = dataRows.filter((row) => !(row[spotifyIdx] ?? "").trim() && ((row[titleIdx] ?? "").trim() || (row[artistIdx] ?? "").trim())).length;

  if (targets.length === 0) {
    return NextResponse.json({ written: 0, mismatched: 0, notFound: 0, total: 0, totalEmpty: 0, mismatches: [], message: "対象行なし（Spotify URLが空の行はありません）" });
  }

  let written = 0, mismatched = 0, notFound = 0;
  const mismatches: RefetchMismatch[] = [];

  for (const { row, rowNum } of targets) {
    const sheetTitle  = (row[titleIdx]  ?? "").trim();
    const sheetArtist = (row[artistIdx] ?? "").trim();

    try {
      const results = await searchAlbums(`${sheetArtist} ${sheetTitle}`);
      const found = results[0];

      if (!found?.spotifyUrl?.startsWith("https://open.spotify.com/")) {
        notFound++;
        await sleep(300);
        continue;
      }

      const tOk = titleMatch(sheetTitle, found.name);
      const aOk = artistMatch(sheetArtist, found.artist);

      if (!tOk || !aOk) {
        mismatches.push({
          rowNum,
          sheetTitle,
          sheetArtist,
          spotifyTitle:  found.name,
          spotifyArtist: found.artist,
          spotifyUrl:    found.spotifyUrl,
        });
        mismatched++;
        await sleep(300);
        continue;
      }

      // 一致 → シートに書き込み
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'Release Master'!${cSpotify}${rowNum}`, values: [[found.spotifyUrl]] },
            ...(cCover && found.coverUrl ? [{ range: `'Release Master'!${cCover}${rowNum}`, values: [[found.coverUrl]] }] : []),
          ],
        },
      });
      written++;
    } catch (e) {
      console.error(`refetch-spotify row ${rowNum}:`, e);
    }

    await sleep(300);
  }

  invalidateCache(CACHE_KEY.RELEASE_MASTER);
  return NextResponse.json({ written, mismatched, notFound, total: targets.length, totalEmpty, mismatches });
}
