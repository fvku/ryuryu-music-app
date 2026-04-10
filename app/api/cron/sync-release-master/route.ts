import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAllScores, addScore, updateScore, initScoresSheet } from "@/lib/sheets";
import { getReleaseMasterScoreRows } from "@/lib/release-master";
import { LEGACY_NAME_TO_EMAIL, EMAIL_TO_SHORT_NAME } from "@/lib/members";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYNC_DELAY_MS = 2 * 60 * 1000; // 2 minutes

function parseCellScore(value: string): { score: number | null; comment: string } {
  const trimmed = value.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    const num = parseFloat(trimmed);
    return { score: isNaN(num) ? null : num, comment: "" };
  }
  const num = parseFloat(trimmed.substring(0, spaceIdx));
  return { score: isNaN(num) ? null : num, comment: trimmed.substring(spaceIdx + 1).trim() };
}

/** memberName（短縮名・旧形式・email）をすべて canonical email に正規化する */
function normalizeToEmail(memberName: string): string {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (lower in EMAIL_TO_SHORT_NAME) return lower;
  return LEGACY_NAME_TO_EMAIL[lower] ?? lower;
}

function getSheetsClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
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
  return google.sheets({ version: "v4", auth });
}

export async function GET() {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("GOOGLE_SPREADSHEET_ID is not set");

    const sheets = getSheetsClient();

    // ── 1. 初期データを並列取得（API 3 回のみ）──
    const [rmRows, allScores, rawPendingRes] = await Promise.all([
      getReleaseMasterScoreRows(),
      getAllScores(),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A1:D" }),
    ]);

    // sync_pending をヘッダー込みで読み込み、行インデックス付きマップを構築
    const rawPendingRows = rawPendingRes.data.values ?? [];
    // 必要なら 1行目（ヘッダー）を作成
    if (rawPendingRows.length === 0 || rawPendingRows[0]?.[0] !== "albumNo") {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "sync_pending!A1:D1",
        valueInputOption: "RAW",
        requestBody: { values: [["albumNo", "memberEmail", "cellValue", "detectedAt"]] },
      });
    }

    // pendingDataMap: "albumNo::email" → { cellValue, detectedAt, rowIndex(1-based, skip header) }
    type PendingEntry = { cellValue: string; detectedAt: string; rowIndex: number };
    const pendingDataMap = new Map<string, PendingEntry>();
    for (let i = 1; i < rawPendingRows.length; i++) {
      const r = rawPendingRows[i];
      const albumNo = (r?.[0] ?? "").trim();
      const email   = (r?.[1] ?? "").trim();
      if (albumNo && email) {
        pendingDataMap.set(`${albumNo}::${email}`, {
          cellValue:  (r?.[2] ?? "").trim(),
          detectedAt: (r?.[3] ?? "").trim(),
          rowIndex:   i + 1, // 1-based; row 1 = header, row 2 = i=1
        });
      }
    }
    // 次に追加する行のインデックス（既存行数+1）
    let nextPendingRow = rawPendingRows.length + 1;

    // appScoreMap: "albumTitle::artistName::normalizedEmail" → Score
    // memberName を正規化して短縮名と email 混在に対応する
    const appScoreMap = new Map<string, typeof allScores[0]>();
    for (const s of allScores) {
      const k = `${(s.albumTitle ?? "").trim()}::${(s.artistName ?? "").trim()}::${normalizeToEmail(s.memberName ?? "")}`;
      const existing = appScoreMap.get(k);
      if (!existing || s.submittedAt > existing.submittedAt) appScoreMap.set(k, s);
    }

    const now = Date.now();

    // ── 2. RM 行を処理し、sync/pending 操作を収集 ──
    const synced: string[] = [];
    const added:  string[] = [];

    // pending 操作（後でバッチ実行）
    const pendingRowsToClear:  number[] = [];                                           // 行番号（1-based）
    const pendingRowsToUpdate: { rowIndex: number; values: string[] }[] = [];           // 既存行の更新
    const pendingRowsToAppend: { albumNo: string; email: string; cellValue: string }[] = []; // 新規追加

    await initScoresSheet();

    for (const row of rmRows) {
      for (const [email, cellValue] of Object.entries(row.memberScores)) {
        const { score, comment } = parseCellScore(cellValue);
        if (score !== null && (score < 0 || score > 10)) continue;
        if (score === null && !comment) continue;

        const pendingKey = `${row.albumNo}::${email}`;
        const existingAppScore = appScoreMap.get(
          `${row.albumTitle.trim()}::${row.artistName.trim()}::${email.toLowerCase().trim()}`
        );

        // 既に同じ値で同期済み → pending があれば削除予約してスキップ
        if (existingAppScore && existingAppScore.score === score && existingAppScore.comment === comment) {
          const pending = pendingDataMap.get(pendingKey);
          if (pending) pendingRowsToClear.push(pending.rowIndex);
          continue;
        }

        const pending = pendingDataMap.get(pendingKey);

        if (!pending) {
          // 初回検知 → pending 追加予約
          pendingRowsToAppend.push({ albumNo: row.albumNo, email, cellValue });
          added.push(pendingKey);
          continue;
        }

        if (pending.cellValue !== cellValue) {
          // 値が変わった → タイマーリセット予約
          pendingRowsToUpdate.push({
            rowIndex: pending.rowIndex,
            values: [row.albumNo, email, cellValue, new Date().toISOString()],
          });
          added.push(`${pendingKey}(reset)`);
          continue;
        }

        // 同じ値、2分未満 → 待機
        const detectedAt = new Date(pending.detectedAt).getTime();
        if (now - detectedAt < SYNC_DELAY_MS) continue;

        // 2分経過 → scores シートに書き込み（ここだけ逐次 API）
        const altNames = Object.entries(LEGACY_NAME_TO_EMAIL)
          .filter(([, e]) => e === email)
          .map(([name]) => name);

        if (existingAppScore) {
          await updateScore(row.albumTitle, row.artistName, email, score, comment, altNames, pending.detectedAt);
        } else {
          await addScore({
            reviewId: row.albumNo,
            memberName: email,
            score,
            comment,
            albumTitle: row.albumTitle,
            artistName: row.artistName,
            submittedAt: pending.detectedAt,
          });
        }

        pendingRowsToClear.push(pending.rowIndex);
        synced.push(pendingKey);
      }
    }

    // ── 3. pending 操作をバッチ実行（API 最大 3 回）──

    // 3-a. 削除（batchClear）
    if (pendingRowsToClear.length > 0) {
      await sheets.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: {
          ranges: pendingRowsToClear.map((r) => `sync_pending!A${r}:D${r}`),
        },
      });
    }

    // 3-b. タイマーリセット（batchUpdate）
    if (pendingRowsToUpdate.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: pendingRowsToUpdate.map((u) => ({
            range: `sync_pending!A${u.rowIndex}:D${u.rowIndex}`,
            values: [u.values],
          })),
        },
      });
    }

    // 3-c. 新規追加（batchUpdate on pre-calculated rows）
    if (pendingRowsToAppend.length > 0) {
      const now2 = new Date().toISOString();
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: pendingRowsToAppend.map((entry, i) => ({
            range: `sync_pending!A${nextPendingRow + i}:D${nextPendingRow + i}`,
            values: [[entry.albumNo, entry.email, entry.cellValue, now2]],
          })),
        },
      });
    }

    return NextResponse.json({ ok: true, synced, added });
  } catch (error) {
    console.error("Sync cron failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
