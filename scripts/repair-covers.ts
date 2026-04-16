/**
 * Release Master の spotifyカバー列を Spotify API から正しい画像URLで修復する。
 *
 * 対象: spotifyUrl が open.spotify.com/album/... の形式で存在するが、
 *       coverUrl が別アルバムのものになっている（または空）行。
 *
 * --all オプションを付けると全行を対象に再取得（デフォルトは coverUrl が空の行のみ）。
 *
 * 実行方法:
 *   npx tsx scripts/repair-covers.ts          # coverUrl が空の行のみ
 *   npx tsx scripts/repair-covers.ts --all    # spotifyUrl がある全行を再取得
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const forceAll = process.argv.includes("--all");

const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY!;
let credentials;
try {
  credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8"));
} catch {
  credentials = JSON.parse(keyJson);
}
if (credentials.private_key) {
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID!;

const SPOTIFY_ALBUM_RE = /open\.spotify\.com\/(?:[^/]+\/)?album\/([A-Za-z0-9]+)/;

async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) {
    console.log("データなし");
    return;
  }

  const [headerRow, ...dataRows] = allRows;

  // ヘッダーから列インデックスを解決
  const colMap: Record<string, number> = {};
  headerRow.forEach((h: string, i: number) => { if (h) colMap[h.trim()] = i; });

  const spotifyIdx = colMap["Spotify"] ?? -1;
  const coverIdx   = colMap["spotifyカバー"] ?? -1;
  const noIdx      = colMap["No."] ?? 0;
  const titleIdx   = colMap["アルバム名"] ?? 2;

  if (spotifyIdx < 0 || coverIdx < 0) {
    console.error("Spotify または spotifyカバー 列が見つかりません");
    process.exit(1);
  }

  // 列文字を計算
  function idxToCol(i: number): string {
    if (i < 26) return String.fromCharCode(i + 65);
    return String.fromCharCode(Math.floor(i / 26) + 64) + String.fromCharCode((i % 26) + 65);
  }
  const coverColLetter = idxToCol(coverIdx);

  // 対象行を抽出
  const targets: { rowNum: number; no: string; title: string; albumId: string; currentCover: string }[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const spotifyUrl  = (row[spotifyIdx] ?? "").trim();
    const currentCover = (row[coverIdx] ?? "").trim();
    const no = (row[noIdx] ?? "").trim();
    const title = (row[titleIdx] ?? "").trim();

    if (!spotifyUrl) continue;

    const match = spotifyUrl.match(SPOTIFY_ALBUM_RE);
    if (!match) continue;

    if (!forceAll && currentCover) continue; // --all なければ cover が空の行だけ

    targets.push({ rowNum: i + 2, no, title, albumId: match[1], currentCover });
  }

  console.log(`対象行数: ${targets.length}${forceAll ? " (--all)" : " (coverUrl が空の行のみ)"}`);
  if (targets.length === 0) {
    console.log("修復対象なし。--all で全行を対象にできます。");
    return;
  }

  const token = await getSpotifyToken();
  let fixed = 0;
  let failed = 0;

  for (const t of targets) {
    const newCover = await fetchCoverUrl(t.albumId, token);
    if (!newCover) {
      console.log(`  ✗ [${t.no}] ${t.title} → Spotify取得失敗`);
      failed++;
      await sleep(200);
      continue;
    }

    if (newCover === t.currentCover) {
      console.log(`  - [${t.no}] ${t.title} → 変更なし`);
      await sleep(200);
      continue;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Release Master'!${coverColLetter}${t.rowNum}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newCover]] },
    });

    console.log(`  ✓ [${t.no}] ${t.title}`);
    console.log(`      before: ${t.currentCover || "(空)"}`);
    console.log(`      after:  ${newCover}`);
    fixed++;
    await sleep(200);
  }

  console.log(`\n完了: 修復 ${fixed}件 / 失敗 ${failed}件`);
}

main().catch(console.error);
