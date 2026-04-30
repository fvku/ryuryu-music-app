import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EMAIL_TO_RM_COL: Record<string, string> = {
  "kwisoo1102@gmail.com":       "Kwisoo",
  "akyme68@gmail.com":          "Meri",
  "kohei.fuku0926@gmail.com":   "Kohei",
  "edwardcannell93@gmail.com":  "Eddie",
  "yoshinorihnw@gmail.com":     "Hanawa",
  "qururiquiqui@gmail.com":     "Kaede",
};

const LEGACY_TO_EMAIL: Record<string, string> = {
  "kohei":        "kohei.fuku0926@gmail.com",
  "kohei fukuda": "kohei.fuku0926@gmail.com",
  "meri":         "akyme68@gmail.com",
  "hanawa":       "yoshinorihnw@gmail.com",
  "eddie":        "edwardcannell93@gmail.com",
  "kwisoo":       "kwisoo1102@gmail.com",
  "kaede":        "qururiquiqui@gmail.com",
};

function normalizeEmail(memberName: string): string | null {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (lower in EMAIL_TO_RM_COL) return lower;
  return LEGACY_TO_EMAIL[lower] ?? null;
}

function colLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function getSheetsClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try { credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8")); }
  catch { credentials = JSON.parse(keyJson); }
  if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return google.sheets({ version: "v4", auth });
}

export async function POST(req: NextRequest) {
  const { adminPassword, force = false } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const rmSpreadsheetId  = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!appSpreadsheetId || !rmSpreadsheetId) {
    return NextResponse.json({ error: "環境変数が設定されていません" }, { status: 500 });
  }

  const sheets = getSheetsClient();

  const [scoresRes, rmRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: appSpreadsheetId, range: "scores!A2:G" }),
    sheets.spreadsheets.values.get({ spreadsheetId: rmSpreadsheetId, range: "'Release Master'!A1:AZ" }),
  ]);

  const scoreRows = scoresRes.data.values ?? [];
  const allRows   = rmRes.data.values ?? [];
  if (allRows.length < 2) return NextResponse.json({ error: "Release Masterにデータがありません" }, { status: 404 });

  // scores シートから最新エントリを収集
  type ScoreEntry = { score: string; comment: string; submittedAt: string };
  const latestMap = new Map<string, ScoreEntry>();
  for (const row of scoreRows) {
    const memberName  = (row[1] ?? "").trim();
    const score       = (row[2] ?? "").trim();
    const comment     = (row[3] ?? "").trim();
    const submittedAt = (row[4] ?? "").trim();
    const albumTitle  = (row[5] ?? "").trim();
    const artistName  = (row[6] ?? "").trim();
    if (!albumTitle || !artistName || !score) continue;
    const email = normalizeEmail(memberName);
    if (!email) continue;
    const key = `${albumTitle}::${artistName}::${email}`;
    const existing = latestMap.get(key);
    if (!existing || submittedAt > existing.submittedAt) {
      latestMap.set(key, { score, comment, submittedAt });
    }
  }

  // Release Master ヘッダーとアルバム行マップを構築
  const [headerRow, ...dataRows] = allRows;
  const colMap: Record<string, number> = {};
  headerRow.forEach((h: string, i: number) => { if (h) colMap[h.trim()] = i; });

  const titleIdx  = colMap["Title"]  ?? 2;
  const artistIdx = colMap["Artist"] ?? 3;

  const rmRowMap = new Map<string, { rowNum: number; row: string[] }>();
  for (let i = 0; i < dataRows.length; i++) {
    const t = (dataRows[i][titleIdx]  ?? "").trim();
    const a = (dataRows[i][artistIdx] ?? "").trim();
    if (t && a) rmRowMap.set(`${t}::${a}`, { rowNum: i + 2, row: dataRows[i] });
  }

  // 書き込むセルを収集
  type CellWrite = { range: string; values: string[][] };
  const toWrite: CellWrite[] = [];
  let notFound = 0, skipped = 0;

  for (const [key, entry] of Array.from(latestMap.entries())) {
    const parts = key.split("::");
    const albumTitle = parts[0];
    const artistName = parts[1];
    const email      = parts[2];

    const colName = EMAIL_TO_RM_COL[email];
    if (!colName) continue;

    const colIdx = colMap[colName];
    if (colIdx === undefined) continue;

    const rmEntry = rmRowMap.get(`${albumTitle}::${artistName}`);
    if (!rmEntry) { notFound++; continue; }

    const existingVal = (rmEntry.row[colIdx] ?? "").trim();
    if (existingVal && !force) { skipped++; continue; }

    const cellValue = entry.comment ? `${entry.score} ${entry.comment}` : entry.score;
    toWrite.push({
      range: `'Release Master'!${colLetter(colIdx)}${rmEntry.rowNum}`,
      values: [[cellValue]],
    });
  }

  if (toWrite.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: rmSpreadsheetId,
      requestBody: { valueInputOption: "RAW", data: toWrite },
    });
  }

  return NextResponse.json({ written: toWrite.length, notFound, skipped });
}
