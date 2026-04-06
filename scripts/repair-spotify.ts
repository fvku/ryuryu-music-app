/**
 * AC列（Spotify URL列）に誤ってカバー画像URL（https://i.scdn.co/image/...）が
 * 書き込まれている行を検出し、Spotify APIから正しいアルバムURLを再取得して修復する。
 *
 * 実行方法:
 *   npx tsx scripts/repair-spotify.ts
 *
 * .env.local から環境変数を読み込みます。
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

// .env.local を読み込む
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

// --- Spotify ---

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  const clientId = process.env.SPOTIFY_CLIENT_ID;
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

async function searchAlbums(query: string): Promise<{ spotifyUrl: string }[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ q: query, type: "album", limit: "8", market: "JP" });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify search error: ${await res.text()}`);
  const data = await res.json();
  return data.albums.items.map((item: { external_urls: { spotify: string } }) => ({
    spotifyUrl: item.external_urls.spotify,
  }));
}

// --- Google Sheets Auth ---

function getWriteAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8"));
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
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function indexToColumnLetter(index: number): string {
  if (index < 26) return String.fromCharCode(index + 65);
  return String.fromCharCode(Math.floor(index / 26) + 64) + String.fromCharCode((index % 26) + 65);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main ---

async function main() {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  console.log("シートを読み込み中...");
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AD",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;

  // ヘッダーマップ構築
  const col: Record<string, number> = {};
  headerRow.forEach((cell: string, i: number) => {
    const raw = (cell ?? "").trim();
    if (raw) col[raw] = i;
  });

  const spotifyIdx = col["Spotify"];
  if (spotifyIdx === undefined) {
    throw new Error(`"Spotify" 列が見つかりません。実際のヘッダー: ${headerRow.join(", ")}`);
  }
  const cSpotify = indexToColumnLetter(spotifyIdx);
  const noIdx = col["No."] ?? 0;
  const titleIdx = col["アルバム名"] ?? 2;
  const artistIdx = col["アーティスト"] ?? 3;

  // 対象行を抽出
  const targets: { rowNum: number; no: string; title: string; artist: string }[] = [];
  dataRows.forEach((row: string[], i: number) => {
    const current = (row[spotifyIdx] ?? "").trim();
    if (current.startsWith("https://i.scdn.co/image/")) {
      targets.push({
        rowNum: i + 2,
        no: row[noIdx] ?? "",
        title: row[titleIdx] ?? "",
        artist: row[artistIdx] ?? "",
      });
    }
  });

  if (targets.length === 0) {
    console.log("修復対象なし。");
    return;
  }

  console.log(`修復対象: ${targets.length} 件\n`);

  let fixed = 0;
  let failed = 0;

  for (const target of targets) {
    process.stdout.write(`[${target.rowNum}] ${target.artist} - ${target.title} ... `);
    try {
      const results = await searchAlbums(`${target.artist} ${target.title}`);
      const newUrl = results[0]?.spotifyUrl ?? "";

      if (!newUrl || !newUrl.startsWith("https://open.spotify.com/")) {
        console.log("SKIP (Spotifyから見つからず)");
        failed++;
        await sleep(200);
        continue;
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!${cSpotify}${target.rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newUrl]] },
      });

      console.log(`OK → ${newUrl}`);
      fixed++;
    } catch (e) {
      console.log(`ERROR: ${e}`);
      failed++;
    }

    await sleep(200);
  }

  console.log(`\n完了: ${fixed} 件修復, ${failed} 件失敗 (合計 ${targets.length} 件)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
