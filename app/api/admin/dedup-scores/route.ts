import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LEGACY_NAME_TO_EMAIL: Record<string, string> = {
  "kohei": "kohei.fuku0926@gmail.com",
  "kohei fukuda": "kohei.fuku0926@gmail.com",
  "meri": "akyme68@gmail.com",
  "hanawa": "yoshinorihnw@gmail.com",
  "eddie": "edwardcannell93@gmail.com",
  "kwisoo": "kwisoo1102@gmail.com",
  "kaede": "qururiquiqui@gmail.com",
};

const EMAIL_SET = new Set([
  "kohei.fuku0926@gmail.com", "akyme68@gmail.com", "yoshinorihnw@gmail.com",
  "edwardcannell93@gmail.com", "kwisoo1102@gmail.com", "qururiquiqui@gmail.com",
]);

function normalizeToEmail(memberName: string): string {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (EMAIL_SET.has(lower)) return lower;
  return LEGACY_NAME_TO_EMAIL[lower] ?? lower;
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
  const { adminPassword } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) return NextResponse.json({ error: "GOOGLE_SPREADSHEET_ID is not set" }, { status: 500 });

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:G" });
  const rows = res.data.values ?? [];

  type Entry = { rowIndex: number; submittedAt: string; score: string; comment: string };
  const groupMap = new Map<string, Entry[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const albumTitle  = (row[5] ?? "").trim();
    const artistName  = (row[6] ?? "").trim();
    const memberName  = (row[1] ?? "").trim();
    const submittedAt = (row[4] ?? "").trim();
    const score       = (row[2] ?? "").trim();
    const comment     = (row[3] ?? "").trim();
    if (!albumTitle && !artistName) continue;
    const key = `${albumTitle}::${artistName}::${normalizeToEmail(memberName)}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push({ rowIndex: i, submittedAt, score, comment });
  }

  const keepRows = new Set<number>();
  for (const entries of Array.from(groupMap.values())) {
    if (entries.length === 1) { keepRows.add(entries[0].rowIndex); continue; }
    const allSame = entries.every(e => e.score === entries[0].score && e.comment === entries[0].comment);
    if (allSame) {
      keepRows.add(entries.reduce((a, b) => a.submittedAt <= b.submittedAt ? a : b).rowIndex);
    } else {
      keepRows.add(entries.reduce((a, b) => a.submittedAt >= b.submittedAt ? a : b).rowIndex);
    }
  }

  const clearRanges: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const albumTitle = (row[5] ?? "").trim();
    const artistName = (row[6] ?? "").trim();
    if (!albumTitle && !artistName) continue;
    if (!keepRows.has(i)) clearRanges.push(`scores!A${i + 2}:G${i + 2}`);
  }

  if (clearRanges.length > 0) {
    await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: clearRanges } });
  }

  return NextResponse.json({ total: rows.length, kept: keepRows.size, cleared: clearRanges.length });
}
