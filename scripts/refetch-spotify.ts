/**
 * Release Master の Spotify URL が空の行を対象に Spotify APIから再取得する。
 *
 * 取得結果のアルバム名・アーティスト名がシートの値と大文字小文字を除いて
 * 完全一致しない場合は MISMATCH としてアラート表示し、書き込みをスキップする。
 *
 * 実行方法:
 *   npx tsx scripts/refetch-spotify.ts               # dry-run（確認のみ）
 *   npx tsx scripts/refetch-spotify.ts --apply        # 一致した行のみ書き込み
 *   npx tsx scripts/refetch-spotify.ts --apply --force # 不一致行も強制書き込み
 *   npx tsx scripts/refetch-spotify.ts --from-row=200 # 指定行以降のみ対象
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY  = process.argv.includes("--apply");
const FORCE  = process.argv.includes("--force");
const FROM_ROW = (() => {
  const arg = process.argv.find((a) => a.startsWith("--from-row="));
  return arg ? parseInt(arg.split("=")[1]) : 0;
})();

// --- Spotify ---

interface TokenCache { accessToken: string; expiresAt: number; }
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Spotify credentials not set");
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  const data = await res.json();
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.accessToken;
}

interface SpotifyResult {
  name: string;
  artist: string;
  spotifyUrl: string;
  coverUrl: string;
}

async function searchAlbum(query: string): Promise<SpotifyResult | null> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ q: query, type: "album", limit: "8", market: "JP" });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify search error: ${await res.text()}`);
  const data = await res.json();
  const item = data.albums?.items?.[0];
  if (!item) return null;
  return {
    name:       item.name,
    artist:     item.artists.map((a: { name: string }) => a.name).join(", "),
    spotifyUrl: item.external_urls.spotify,
    coverUrl:   item.images?.[0]?.url ?? "",
  };
}

// --- Google Sheets Auth ---

function getWriteAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try { credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8")); }
  catch { credentials = JSON.parse(keyJson); }
  if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function indexToColumnLetter(index: number): string {
  if (index < 26) return String.fromCharCode(index + 65);
  return String.fromCharCode(Math.floor(index / 26) + 64) + String.fromCharCode((index % 26) + 65);
}

function norm(s: string) { return s.trim().toLowerCase(); }

// [EP], [Single] 等のプレフィックスを除去してから比較
function stripTypePrefix(s: string) {
  return s.replace(/^\[(EP|Single|single|ep|Album|album|Compilation|compilation)\]\s*/i, "").trim();
}

function titleMatch(sheetTitle: string, spotifyTitle: string): boolean {
  if (norm(sheetTitle) === norm(spotifyTitle)) return true;
  return norm(stripTypePrefix(sheetTitle)) === norm(stripTypePrefix(spotifyTitle));
}

// アーティスト名を比較用に正規化（& ↔ , の揺れを吸収）
function normArtist(s: string) {
  return norm(s).replace(/\s*&\s*/g, ", ");
}

// アーティスト名の一致判定（Spotifyは "A, B" 形式で複数返すことがある）
function artistMatch(sheetArtist: string, spotifyArtist: string): boolean {
  const a = normArtist(sheetArtist);
  const b = normArtist(spotifyArtist);
  if (a === b) return true;
  // Spotifyのアーティスト文字列にシートのアーティスト名が含まれる場合もOK
  return b.includes(a) || a.includes(b);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// --- Main ---

async function main() {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  console.log("シートを読み込み中...");
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;

  const col: Record<string, number> = {};
  headerRow.forEach((cell: string, i: number) => { const raw = (cell ?? "").trim(); if (raw) col[raw] = i; });

  const spotifyIdx = col["Spotify"];
  const coverIdx   = col["spotifyカバー"];
  if (spotifyIdx === undefined) throw new Error(`"Spotify" 列が見つかりません`);

  const titleIdx  = col["アルバム名"]  ?? 2;
  const artistIdx = col["アーティスト"] ?? 3;

  const cSpotify = indexToColumnLetter(spotifyIdx);
  const cCover   = coverIdx !== undefined ? indexToColumnLetter(coverIdx) : null;

  // 対象行: Spotify URLが空の行
  const targets = dataRows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ rowNum, row }) => {
      if (FROM_ROW > 0 && rowNum < FROM_ROW) return false;
      return !(row[spotifyIdx] ?? "").trim();
    });

  if (targets.length === 0) {
    console.log("対象行なし（Spotify URLが空の行はありません）");
    return;
  }

  console.log(`対象: ${targets.length} 件${APPLY ? (FORCE ? "（強制書き込みモード）" : "（書き込みモード）") : "（dry-run）"}\n`);

  let written = 0, mismatched = 0, notFound = 0;
  const mismatchList: { rowNum: number; title: string; artist: string; spotifyName: string; spotifyArtist: string }[] = [];

  for (const { row, rowNum } of targets) {
    const sheetTitle  = (row[titleIdx]  ?? "").trim();
    const sheetArtist = (row[artistIdx] ?? "").trim();

    if (!sheetTitle && !sheetArtist) {
      console.log(`[行${rowNum}] SKIP（タイトル・アーティストが空）`);
      continue;
    }

    process.stdout.write(`[行${rowNum}] ${sheetArtist} - ${sheetTitle} ... `);

    try {
      const result = await searchAlbum(`${sheetArtist} ${sheetTitle}`);

      if (!result || !result.spotifyUrl.startsWith("https://open.spotify.com/")) {
        console.log("NOT FOUND");
        notFound++;
        await sleep(300);
        continue;
      }

      const titleOk  = titleMatch(sheetTitle, result.name);
      const artistOk = artistMatch(sheetArtist, result.artist);

      if (!titleOk || !artistOk) {
        console.log(`\n  ⚠ MISMATCH`);
        console.log(`    シート  : "${sheetArtist}" / "${sheetTitle}"`);
        console.log(`    Spotify : "${result.artist}" / "${result.name}"`);
        console.log(`    URL     : ${result.spotifyUrl}`);
        mismatchList.push({ rowNum, title: sheetTitle, artist: sheetArtist, spotifyName: result.name, spotifyArtist: result.artist });
        mismatched++;

        if (APPLY && FORCE) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "RAW",
              data: [
                { range: `'Release Master'!${cSpotify}${rowNum}`, values: [[result.spotifyUrl]] },
                ...(cCover ? [{ range: `'Release Master'!${cCover}${rowNum}`, values: [[result.coverUrl]] }] : []),
              ],
            },
          });
          console.log(`    → 強制書き込み済み`);
          written++;
        }
        await sleep(300);
        continue;
      }

      console.log(`OK (Spotify: "${result.artist}" / "${result.name}")`);

      if (APPLY) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: [
              { range: `'Release Master'!${cSpotify}${rowNum}`, values: [[result.spotifyUrl]] },
              ...(cCover ? [{ range: `'Release Master'!${cCover}${rowNum}`, values: [[result.coverUrl]] }] : []),
            ],
          },
        });
        written++;
      }
    } catch (e) {
      console.log(`ERROR: ${e}`);
    }

    await sleep(300);
  }

  console.log("\n========================================");
  console.log(`完了: 書き込み ${written} 件 / MISMATCH ${mismatched} 件 / 見つからず ${notFound} 件`);

  if (mismatchList.length > 0) {
    console.log("\n⚠ MISMATCH 一覧（手動確認が必要）:");
    mismatchList.forEach(({ rowNum, title, artist, spotifyName, spotifyArtist }) => {
      console.log(`  行${rowNum}: "${artist}" / "${title}" → Spotify: "${spotifyArtist}" / "${spotifyName}"`);
    });
    if (!FORCE) {
      console.log("\n  --apply --force を付けて再実行すると MISMATCH 行も強制書き込みします");
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
