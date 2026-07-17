/**
 * scores / bookmarks / recommendations の各行に Release Master の UID を紐付ける
 * （UIDフェーズ2の移行スクリプト）。
 *
 * - 各シートの末尾に albumUid 列を新設する（scores=H, bookmarks=E, recommendations=J）
 * - Release Master の title+artist（trim後の完全一致）→ UID マップで紐付ける
 * - 完全一致しない行は trim+小文字化の緩和マッチを第2段階として試す
 * - RM内で同一 title+artist キーが重複する場合は先頭行のUIDを採用する
 *   （/api/release-master が先頭行のみ残して重複除去するのと同じ扱い）・報告
 * - albumUid が既に入っている行は変更しない（冪等）
 * - マッチしなかった行は空欄のまま残し、一覧を報告する
 *
 * 実行方法:
 *   npx tsx scripts/backfill-album-uids.ts           # dry-run（確認のみ）
 *   npx tsx scripts/backfill-album-uids.ts --apply   # 書き込み
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "../lib/sheet-headers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");

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

interface SheetSpec {
  name: string;
  /** 読み取り範囲の右端列（albumUid列を含む） */
  lastCol: string;
  titleIdx: number;
  artistIdx: number;
  uidIdx: number;
  /** ヘッダー検証用: titleIdx の期待ヘッダー名 */
  titleHeader: string;
}

const TARGETS: SheetSpec[] = [
  { name: "scores",          lastCol: "H", titleIdx: 5, artistIdx: 6, uidIdx: 7, titleHeader: "albumTitle" },
  { name: "bookmarks",       lastCol: "E", titleIdx: 1, artistIdx: 2, uidIdx: 4, titleHeader: "albumTitle" },
  { name: "recommendations", lastCol: "J", titleIdx: 3, artistIdx: 4, uidIdx: 9, titleHeader: "albumTitle" },
];

async function main() {
  const appSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const rmSpreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!appSpreadsheetId || !rmSpreadsheetId) throw new Error("環境変数が設定されていません");

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  console.log(`モード: ${APPLY ? "APPLY（書き込みあり）" : "DRY-RUN（書き込みなし）"}`);

  // ── Release Master → UIDマップ構築 ──────────────────────────────
  console.log("\nRelease Master を読み込み中...");
  const rmRes = await sheets.spreadsheets.values.get({
    spreadsheetId: rmSpreadsheetId,
    range: "'Release Master'!A1:AZ",
  });
  const rmRows = rmRes.data.values ?? [];
  if (rmRows.length < 2) throw new Error("Release Masterにデータがありません");

  const [rmHeader, ...rmData] = rmRows;
  const rmCol = buildHeaderMap(rmHeader);
  const rmTitleIdx = rmCol["Title"] ?? rmCol["アルバム名"] ?? 2;
  const rmArtistIdx = rmCol["Artist"] ?? rmCol["アーティスト"] ?? 3;
  const rmUidIdx = rmCol[SHEET_COL.UID];
  if (rmUidIdx === undefined) throw new Error("Release MasterにUID列がありません");

  const exactMap = new Map<string, string>();   // "title::artist" → uid（先頭行優先）
  const lowerMap = new Map<string, string>();   // 小文字化キー → uid（先頭行優先）
  const duplicateKeys = new Set<string>();
  let rmNoUid = 0;

  for (const row of rmData) {
    const title = (row[rmTitleIdx] ?? "").trim();
    const artist = (row[rmArtistIdx] ?? "").trim();
    const uid = (row[rmUidIdx] ?? "").trim();
    if (!title || !artist) continue;
    if (!uid) { rmNoUid++; continue; }

    const exactKey = `${title}::${artist}`;
    const lowerKey = exactKey.toLowerCase();
    if (exactMap.has(exactKey)) {
      if (exactMap.get(exactKey) !== uid) duplicateKeys.add(exactKey);
    } else {
      exactMap.set(exactKey, uid);
    }
    if (!lowerMap.has(lowerKey)) lowerMap.set(lowerKey, uid);
  }

  console.log(`RMアルバム行: ${rmData.length}, UIDマップ: ${exactMap.size} 件`);
  if (rmNoUid > 0) console.log(`⚠ UID未採番のRM行: ${rmNoUid} 件（マップ対象外）`);
  if (duplicateKeys.size > 0) {
    console.log(`RM内の重複キー（先頭行のUIDを採用）: ${duplicateKeys.size} 件`);
    for (const k of Array.from(duplicateKeys)) console.log(`    ${k.replace("::", " / ")} → ${exactMap.get(k)}`);
  }

  // ── 各シートの紐付け ──────────────────────────────────────────
  const spreadsheetMeta = APPLY ? (await sheets.spreadsheets.get({ spreadsheetId: appSpreadsheetId })).data : null;

  for (const spec of TARGETS) {
    console.log(`\n=== ${spec.name} シート ===`);

    let res;
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: appSpreadsheetId,
        range: `${spec.name}!A1:${spec.lastCol}`,
      });
    } catch {
      console.log("シートが存在しません。スキップ。");
      continue;
    }

    const allRows = res.data.values ?? [];
    if (allRows.length === 0) { console.log("データなし。スキップ。"); continue; }
    const [header, ...dataRows] = allRows;

    if ((header[spec.titleIdx] ?? "").trim() !== spec.titleHeader) {
      throw new Error(
        `${spec.name} のヘッダーが想定と違います: 列${spec.titleIdx + 1} = "${header[spec.titleIdx]}" (期待: "${spec.titleHeader}")`
      );
    }
    const needHeader = (header[spec.uidIdx] ?? "").trim() !== "albumUid";
    if (needHeader && (header[spec.uidIdx] ?? "").trim() !== "") {
      throw new Error(`${spec.name} の ${indexToColumnLetter(spec.uidIdx)}1 に別のヘッダーがあります: "${header[spec.uidIdx]}"`);
    }

    let exactHit = 0;
    let lowerHit = 0;
    let alreadySet = 0;
    let emptyRow = 0;
    const unmatched: string[] = [];

    const columnValues: string[][] = dataRows.map((row, i) => {
      const existing = (row[spec.uidIdx] ?? "").trim();
      if (existing) { alreadySet++; return [existing]; }
      const title = (row[spec.titleIdx] ?? "").trim();
      const artist = (row[spec.artistIdx] ?? "").trim();
      if (!title && !artist) { emptyRow++; return [""]; }

      const exactKey = `${title}::${artist}`;
      const exact = exactMap.get(exactKey);
      if (exact) { exactHit++; return [exact]; }
      const lower = lowerMap.get(exactKey.toLowerCase());
      if (lower) {
        lowerHit++;
        console.log(`  緩和一致: row ${i + 2} "${title} / ${artist}" → ${lower}`);
        return [lower];
      }
      unmatched.push(`row ${i + 2}: ${title} / ${artist}`);
      return [""];
    });

    console.log(`データ行: ${dataRows.length}`);
    console.log(`  完全一致:     ${exactHit}`);
    console.log(`  緩和一致:     ${lowerHit}`);
    console.log(`  設定済み:     ${alreadySet}`);
    console.log(`  空行:         ${emptyRow}`);
    console.log(`  アンマッチ:   ${unmatched.length}`);
    if (unmatched.length > 0) {
      console.log(`  --- アンマッチ一覧（空欄のまま残す） ---`);
      for (const u of unmatched) console.log(`    ${u}`);
    }

    if (!APPLY) continue;
    if (exactHit + lowerHit === 0 && !needHeader) { console.log("書き込みなし。"); continue; }

    // グリッドの列数が足りなければ拡張
    const sheetMeta = spreadsheetMeta!.sheets?.find((s) => s.properties?.title === spec.name);
    const sheetId = sheetMeta?.properties?.sheetId;
    const colCount = sheetMeta?.properties?.gridProperties?.columnCount ?? 0;
    if (sheetId !== undefined && spec.uidIdx >= colCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: appSpreadsheetId,
        requestBody: {
          requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: spec.uidIdx - colCount + 1 } }],
        },
      });
      console.log(`グリッドを ${colCount} 列 → ${spec.uidIdx + 1} 列に拡張しました`);
    }

    const cUid = indexToColumnLetter(spec.uidIdx);
    if (needHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: appSpreadsheetId,
        range: `${spec.name}!${cUid}1`,
        valueInputOption: "RAW",
        requestBody: { values: [["albumUid"]] },
      });
      console.log(`ヘッダー "albumUid" を ${cUid}1 に書き込みました`);
    }

    if (dataRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: appSpreadsheetId,
        range: `${spec.name}!${cUid}2:${cUid}${dataRows.length + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: columnValues },
      });
    }
    console.log(`完了: ${exactHit + lowerHit} 行に albumUid を書き込みました`);
  }

  if (!APPLY) {
    console.log("\n--- dry-run 完了。実際に書き込む場合は --apply を付けて再実行してください。---");
  } else {
    console.log("\n--- 全処理完了 ---");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
