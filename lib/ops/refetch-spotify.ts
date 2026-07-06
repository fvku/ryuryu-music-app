/**
 * Release Master の Spotify URL が空の行を Spotify から再取得するコアロジック。
 * scripts/refetch-spotify.ts（CLI）と app/api/admin/refetch-spotify（管理画面）の共通実装。
 *
 * アルバム名・アーティスト名がシートの値と一致しない場合は MISMATCH として
 * 書き込みをスキップする（force 指定時のみ強制書き込み）。
 */

import { google } from "googleapis";
import { searchAlbums } from "@/lib/spotify";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function norm(s: string) { return s.trim().toLowerCase(); }

/** [EP], [Single] 等のプレフィックスを除去してから比較 */
function stripTypePrefix(s: string) {
  return s.replace(/^\[(EP|Single|single|ep|Album|album|Compilation|compilation)\]\s*/i, "").trim();
}

function titleMatch(sheetTitle: string, spotifyTitle: string): boolean {
  if (norm(sheetTitle) === norm(spotifyTitle)) return true;
  return norm(stripTypePrefix(sheetTitle)) === norm(stripTypePrefix(spotifyTitle));
}

/** アーティスト名を比較用に正規化（& ↔ , の揺れを吸収） */
function normArtist(s: string) { return norm(s).replace(/\s*&\s*/g, ", "); }

/** アーティスト名の一致判定（Spotifyは "A, B" 形式で複数返すことがある） */
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

export interface RefetchSpotifyOptions {
  /** false = dry-run（書き込まない） */
  apply: boolean;
  /** MISMATCH行も強制書き込み（CLI専用オプション） */
  force?: boolean;
  /** 指定行以降のみ対象（CLI専用オプション） */
  fromRow?: number;
  /** 先頭からN件のみ処理（API側のタイムアウト対策） */
  limit?: number;
  /** 進捗ログ（CLIは console.log、APIは省略） */
  log?: (msg: string) => void;
}

export interface RefetchSpotifyResult {
  written: number;
  mismatched: number;
  notFound: number;
  total: number;
  totalEmpty: number;
  mismatches: RefetchMismatch[];
}

export async function refetchSpotifyUrls(options: RefetchSpotifyOptions): Promise<RefetchSpotifyResult> {
  const { apply, force = false, fromRow = 0, limit, log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  log("シートを読み込み中...");
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];
  const coverIdx   = col[SHEET_COL.COVER_URL];
  const titleIdx   = col["Title"]  ?? col["アルバム名"]   ?? 2;
  const artistIdx  = col["Artist"] ?? col["アーティスト"] ?? 3;

  if (spotifyIdx === undefined) throw new Error(`"${SHEET_COL.SPOTIFY_URL}" 列が見つかりません`);

  const cSpotify = indexToColumnLetter(spotifyIdx);
  const cCover   = coverIdx !== undefined ? indexToColumnLetter(coverIdx) : null;

  // 対象行: Spotify URLが空で、タイトルまたはアーティストがある行
  const isTarget = (row: string[]) =>
    !(row[spotifyIdx] ?? "").trim() && !!((row[titleIdx] ?? "").trim() || (row[artistIdx] ?? "").trim());

  const allTargets = dataRows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => isTarget(row))
    .filter(({ rowNum }) => fromRow <= 0 || rowNum >= fromRow);

  const totalEmpty = allTargets.length;
  const targets = limit !== undefined ? allTargets.slice(0, limit) : allTargets;

  const result: RefetchSpotifyResult = {
    written: 0, mismatched: 0, notFound: 0,
    total: targets.length, totalEmpty, mismatches: [],
  };

  if (targets.length === 0) {
    log("対象行なし（Spotify URLが空の行はありません）");
    return result;
  }

  log(`対象: ${targets.length} 件${apply ? (force ? "（強制書き込みモード）" : "（書き込みモード）") : "（dry-run）"}`);

  const writeRow = async (rowNum: number, spotifyUrl: string, coverUrl: string) => {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `'Release Master'!${cSpotify}${rowNum}`, values: [[spotifyUrl]] },
          ...(cCover && coverUrl ? [{ range: `'Release Master'!${cCover}${rowNum}`, values: [[coverUrl]] }] : []),
        ],
      },
    });
  };

  for (const { row, rowNum } of targets) {
    const sheetTitle  = (row[titleIdx]  ?? "").trim();
    const sheetArtist = (row[artistIdx] ?? "").trim();

    try {
      const results = await searchAlbums(`${sheetArtist} ${sheetTitle}`);
      const found = results[0];

      if (!found?.spotifyUrl?.startsWith("https://open.spotify.com/")) {
        log(`[行${rowNum}] ${sheetArtist} - ${sheetTitle} ... NOT FOUND`);
        result.notFound++;
        await sleep(300);
        continue;
      }

      const tOk = titleMatch(sheetTitle, found.name);
      const aOk = artistMatch(sheetArtist, found.artist);

      if (!tOk || !aOk) {
        log(`[行${rowNum}] ⚠ MISMATCH シート:"${sheetArtist}" / "${sheetTitle}" → Spotify:"${found.artist}" / "${found.name}"`);
        result.mismatches.push({
          rowNum, sheetTitle, sheetArtist,
          spotifyTitle: found.name, spotifyArtist: found.artist, spotifyUrl: found.spotifyUrl,
        });
        result.mismatched++;
        if (apply && force) {
          await writeRow(rowNum, found.spotifyUrl, found.coverUrl ?? "");
          log(`  → 強制書き込み済み`);
          result.written++;
        }
        await sleep(300);
        continue;
      }

      log(`[行${rowNum}] ${sheetArtist} - ${sheetTitle} ... OK`);
      if (apply) {
        await writeRow(rowNum, found.spotifyUrl, found.coverUrl ?? "");
        result.written++;
      }
    } catch (e) {
      log(`[行${rowNum}] ERROR: ${e}`);
      console.error(`refetch-spotify row ${rowNum}:`, e);
    }

    await sleep(300);
  }

  return result;
}
