/**
 * spotifyカバー列が空（または --all で全行）の行に対して、
 * Spotify URL からカバー画像URLを取得して補完するコアロジック。
 * scripts/repair-covers.ts（CLI）と app/api/admin/repair-covers（管理画面）の共通実装。
 */

import { google } from "googleapis";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

const SPOTIFY_ALBUM_RE = /open\.spotify\.com\/(?:[^/]+\/)?album\/([A-Za-z0-9]+)/;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Spotify credentials not set");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function fetchCoverUrl(albumId: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json() as { images?: { url: string }[] };
  return data.images?.[0]?.url ?? null;
}

export interface RepairCoversOptions {
  /** カバーが埋まっている行も再取得対象にする（CLI --all） */
  forceAll?: boolean;
  /** 先頭からN件のみ処理（API側のタイムアウト対策） */
  limit?: number;
  log?: (msg: string) => void;
}

export interface RepairCoversResult {
  total: number;
  fixed: number;
  failed: number;
  noChange: number;
}

export async function repairCovers(options: RepairCoversOptions = {}): Promise<RepairCoversResult> {
  const { forceAll = false, limit, log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL] ?? -1;
  const coverIdx   = col[SHEET_COL.COVER_URL]   ?? -1;
  const noIdx      = col["No."]                         ?? 0;
  const titleIdx   = col["Title"] ?? col["アルバム名"]  ?? 2;
  if (spotifyIdx < 0 || coverIdx < 0) {
    throw new Error(`${SHEET_COL.SPOTIFY_URL} または ${SHEET_COL.COVER_URL} 列が見つかりません`);
  }
  const coverColLetter = indexToColumnLetter(coverIdx);

  const allTargets = dataRows
    .map((row, i) => ({
      rowNum: i + 2,
      no:     (row[noIdx]      ?? "").trim(),
      title:  (row[titleIdx]   ?? "").trim(),
      spotifyUrl:   (row[spotifyIdx] ?? "").trim(),
      currentCover: (row[coverIdx]   ?? "").trim(),
    }))
    .filter((r) => {
      if (!r.spotifyUrl || !SPOTIFY_ALBUM_RE.test(r.spotifyUrl)) return false;
      return forceAll || !r.currentCover;
    });

  const targets = limit !== undefined ? allTargets.slice(0, limit) : allTargets;

  const result: RepairCoversResult = { total: targets.length, fixed: 0, failed: 0, noChange: 0 };

  log(`対象行数: ${targets.length}${forceAll ? " (--all)" : " (coverUrl が空の行のみ)"}`);
  if (targets.length === 0) {
    log("補完対象なし。");
    return result;
  }

  const token = await getSpotifyToken();

  for (const t of targets) {
    const match = t.spotifyUrl.match(SPOTIFY_ALBUM_RE);
    if (!match) { result.failed++; continue; }

    const newCover = await fetchCoverUrl(match[1], token);
    if (!newCover) {
      log(`  ✗ [${t.no}] ${t.title} → Spotify取得失敗`);
      result.failed++;
      await sleep(200);
      continue;
    }
    if (newCover === t.currentCover) {
      log(`  - [${t.no}] ${t.title} → 変更なし`);
      result.noChange++;
      await sleep(200);
      continue;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Release Master'!${coverColLetter}${t.rowNum}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newCover]] },
    });

    log(`  ✓ [${t.no}] ${t.title}`);
    result.fixed++;
    await sleep(200);
  }

  return result;
}
