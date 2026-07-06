import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { cached, invalidateCache, CACHE_KEY, CACHE_TTL } from "@/lib/api-cache";
import { getGoogleAuth } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

const SHEET_NAME = "settings";

async function ensureSettingsSheet(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:B1`,
      valueInputOption: "RAW",
      requestBody: { values: [["key", "value"]] },
    });
  }
}

async function readSettings(spreadsheetId: string): Promise<Record<string, string>> {
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:B`,
    });
    const rows = res.data.values ?? [];
    return Object.fromEntries(rows.filter((r) => r[0]).map((r) => [r[0] as string, (r[1] as string) ?? ""]));
  } catch {
    return {};
  }
}

// GET — 全設定を返す（認証不要：ホームページからも呼ばれる）
export async function GET() {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return NextResponse.json({ error: "GOOGLE_SPREADSHEET_ID is not set" }, { status: 500 });
    const settings = await cached(CACHE_KEY.SETTINGS, CACHE_TTL.SETTINGS, () => readSettings(spreadsheetId));
    return NextResponse.json(settings);
  } catch (e) {
    console.error("Failed to read settings:", e);
    return NextResponse.json({}, { status: 200 }); // 失敗しても空オブジェクトを返す
  }
}

// PATCH — 設定を更新（管理者のみ）
export async function PATCH(req: NextRequest) {
  try {
    const { adminPassword, key, value } = await req.json() as { adminPassword: string; key: string; value: string };
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return NextResponse.json({ error: "GOOGLE_SPREADSHEET_ID is not set" }, { status: 500 });

    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
    await ensureSettingsSheet(sheets, spreadsheetId);

    // 既存の行を探して上書き、なければ末尾に追加
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:A`,
    });
    const keys = (res.data.values ?? []).map((r) => r[0] as string);
    const rowIndex = keys.findIndex((k) => k === key);

    if (rowIndex >= 0) {
      const sheetRow = rowIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${sheetRow}:B${sheetRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [[key, value]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A:B`,
        valueInputOption: "RAW",
        requestBody: { values: [[key, value]] },
      });
    }

    invalidateCache(CACHE_KEY.SETTINGS);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Failed to update settings:", e);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
