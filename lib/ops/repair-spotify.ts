/**
 * Spotify URL列に誤ってカバー画像URL（https://i.scdn.co/image/...）が
 * 書き込まれている行を検出し、正しいアルバムURLを再取得して修復するコアロジック。
 * scripts/repair-spotify.ts（CLI）と app/api/admin/repair-spotify（管理画面）の共通実装。
 */

import { google } from "googleapis";
import { searchAlbums } from "@/lib/spotify";
import { buildHeaderMap, findMissingColumns, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export interface RepairSpotifyResult {
  total: number;
  fixed: number;
  failed: number;
  details: { no: string; title: string; artist: string; newUrl: string }[];
}

export async function repairSpotifyUrls(options: { log?: (msg: string) => void } = {}): Promise<RepairSpotifyResult> {
  const { log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  log("シートを読み込み中...");
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const missing = findMissingColumns(col, [SHEET_COL.SPOTIFY_URL]);
  if (missing.length > 0) throw new Error(`列が見つかりません: ${missing.join(", ")}`);

  const noIdx      = col["No."]                          ?? 0;
  const titleIdx   = col["Title"]  ?? col["アルバム名"]   ?? 2;
  const artistIdx  = col["Artist"] ?? col["アーティスト"] ?? 3;
  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];
  const cSpotify   = indexToColumnLetter(spotifyIdx);

  // Spotify URL列がカバー画像URLになっている行を抽出
  const targets: { rowNum: number; no: string; title: string; artist: string }[] = [];
  dataRows.forEach((row, i) => {
    const current = (row[spotifyIdx] ?? "").trim();
    if (current.startsWith("https://i.scdn.co/image/")) {
      targets.push({
        rowNum: i + 2,
        no:     row[noIdx]     ?? "",
        title:  row[titleIdx]  ?? "",
        artist: row[artistIdx] ?? "",
      });
    }
  });

  const result: RepairSpotifyResult = { total: targets.length, fixed: 0, failed: 0, details: [] };

  if (targets.length === 0) {
    log("修復対象なし。");
    return result;
  }

  log(`修復対象: ${targets.length} 件`);

  for (const target of targets) {
    try {
      const results = await searchAlbums(`${target.artist} ${target.title}`);
      const newUrl = results[0]?.spotifyUrl ?? "";

      if (!newUrl || !newUrl.startsWith("https://open.spotify.com/")) {
        log(`[${target.rowNum}] ${target.artist} - ${target.title} ... SKIP (Spotifyから見つからず)`);
        result.failed++;
        await sleep(200);
        continue;
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!${cSpotify}${target.rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newUrl]] },
      });

      log(`[${target.rowNum}] ${target.artist} - ${target.title} ... OK → ${newUrl}`);
      result.details.push({ no: target.no, title: target.title, artist: target.artist, newUrl });
      result.fixed++;
    } catch (e) {
      log(`[${target.rowNum}] ERROR: ${e}`);
      console.error(`Failed to repair row ${target.rowNum} (${target.title}):`, e);
      result.failed++;
    }

    await sleep(200);
  }

  return result;
}
