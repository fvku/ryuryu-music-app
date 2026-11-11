import { google } from "googleapis";
import { getGoogleAuth } from "./google-auth";
import { summarizeCronLogs, type CronStatusReport } from "./cron-status";

/** 読み取り専用。シート未作成でも作成やログ追記はしない。 */
export async function readCronStatus(): Promise<CronStatusReport> {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Cron status is not configured");
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(false) });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId, fields: "sheets.properties.title",
  });
  if (!meta.data.sheets?.some(sheet => sheet.properties?.title === "admin_logs")) {
    return summarizeCronLogs([], new Date(), false);
  }
  // 自由記述のdetail（E列）には外部エラー等が入るため取得・公開しない。
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "admin_logs!A:D" });
  const [headers, ...rows] = response.data.values ?? [];
  if (!["timestamp", "email", "action", "result"].every((name, i) => headers?.[i] === name)) {
    throw new Error("Unexpected admin log headers");
  }
  return summarizeCronLogs(rows);
}
