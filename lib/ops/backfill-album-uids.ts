/**
 * scores / bookmarks / recommendations の各行に Release Master の UID を紐付けるコアロジック。
 * scripts/backfill-album-uids.ts（CLI）と app/api/admin/backfill-album-uids（管理画面）の共通実装。
 *
 * - Release Master の title+artist（trim後の完全一致）→ UID マップで紐付ける
 * - 完全一致しない行は trim+小文字化の緩和マッチを第2段階として試す
 * - RM内で同一 title+artist キーが重複する場合は先頭行のUIDを採用する
 * - albumUid が既に入っている行は変更しない（冪等）
 * - マッチしなかった行は空欄のまま残し、一覧を報告する
 */

import { google } from "googleapis";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

export interface BackfillAlbumUidsOptions {
  /** false = dry-run（書き込まない） */
  apply: boolean;
  log?: (msg: string) => void;
}

export interface BackfillSheetResult {
  sheet: string;
  skipped: boolean;
  skipReason?: string;
  total: number;
  exactHit: number;
  lowerHit: number;
  alreadySet: number;
  emptyRow: number;
  unmatched: string[];
}

export interface BackfillAlbumUidsResult {
  rmAlbumRows: number;
  rmUidMapSize: number;
  rmNoUid: number;
  duplicateKeys: number;
  sheets: BackfillSheetResult[];
}

interface SheetSpec {
  name: string;
  lastCol: string;
  titleIdx: number;
  artistIdx: number;
  uidIdx: number;
  titleHeader: string;
}

const TARGETS: SheetSpec[] = [
  { name: "scores",          lastCol: "H", titleIdx: 5, artistIdx: 6, uidIdx: 7, titleHeader: "albumTitle" },
  { name: "bookmarks",       lastCol: "E", titleIdx: 1, artistIdx: 2, uidIdx: 4, titleHeader: "albumTitle" },
  { name: "recommendations", lastCol: "J", titleIdx: 3, artistIdx: 4, uidIdx: 9, titleHeader: "albumTitle" },
];

export async function backfillAlbumUids(options: BackfillAlbumUidsOptions): Promise<BackfillAlbumUidsResult> {
  const { apply, log = () => {} } = options;

  const appSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const rmSpreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!appSpreadsheetId || !rmSpreadsheetId) throw new Error("環境変数が設定されていません");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  log(`モード: ${apply ? "APPLY（書き込みあり）" : "DRY-RUN（書き込みなし）"}`);

  // ── Release Master → UIDマップ構築 ──────────────────────────────
  log("\nRelease Master を読み込み中...");
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

  const exactMap = new Map<string, string>();
  const lowerMap = new Map<string, string>();
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

  log(`RMアルバム行: ${rmData.length}, UIDマップ: ${exactMap.size} 件`);
  if (rmNoUid > 0) log(`⚠ UID未採番のRM行: ${rmNoUid} 件（マップ対象外）`);
  if (duplicateKeys.size > 0) {
    log(`RM内の重複キー（先頭行のUIDを採用）: ${duplicateKeys.size} 件`);
    for (const k of Array.from(duplicateKeys)) log(`    ${k.replace("::", " / ")} → ${exactMap.get(k)}`);
  }

  const result: BackfillAlbumUidsResult = {
    rmAlbumRows: rmData.length,
    rmUidMapSize: exactMap.size,
    rmNoUid,
    duplicateKeys: duplicateKeys.size,
    sheets: [],
  };

  // ── 各シートの紐付け ──────────────────────────────────────────
  const spreadsheetMeta = apply ? (await sheets.spreadsheets.get({ spreadsheetId: appSpreadsheetId })).data : null;

  for (const spec of TARGETS) {
    log(`\n=== ${spec.name} シート ===`);

    let res;
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: appSpreadsheetId,
        range: `${spec.name}!A1:${spec.lastCol}`,
      });
    } catch {
      log("シートが存在しません。スキップ。");
      result.sheets.push({
        sheet: spec.name, skipped: true, skipReason: "シートが存在しません",
        total: 0, exactHit: 0, lowerHit: 0, alreadySet: 0, emptyRow: 0, unmatched: [],
      });
      continue;
    }

    const allRows = res.data.values ?? [];
    if (allRows.length === 0) {
      log("データなし。スキップ。");
      result.sheets.push({
        sheet: spec.name, skipped: true, skipReason: "データなし",
        total: 0, exactHit: 0, lowerHit: 0, alreadySet: 0, emptyRow: 0, unmatched: [],
      });
      continue;
    }
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

    const sheetResult: BackfillSheetResult = {
      sheet: spec.name, skipped: false,
      total: dataRows.length, exactHit: 0, lowerHit: 0, alreadySet: 0, emptyRow: 0, unmatched: [],
    };

    const columnValues: string[][] = dataRows.map((row, i) => {
      const existing = (row[spec.uidIdx] ?? "").trim();
      if (existing) { sheetResult.alreadySet++; return [existing]; }
      const title = (row[spec.titleIdx] ?? "").trim();
      const artist = (row[spec.artistIdx] ?? "").trim();
      if (!title && !artist) { sheetResult.emptyRow++; return [""]; }

      const exactKey = `${title}::${artist}`;
      const exact = exactMap.get(exactKey);
      if (exact) { sheetResult.exactHit++; return [exact]; }
      const lower = lowerMap.get(exactKey.toLowerCase());
      if (lower) {
        sheetResult.lowerHit++;
        log(`  緩和一致: row ${i + 2} "${title} / ${artist}" → ${lower}`);
        return [lower];
      }
      sheetResult.unmatched.push(`row ${i + 2}: ${title} / ${artist}`);
      return [""];
    });

    log(`データ行: ${sheetResult.total}`);
    log(`  完全一致:     ${sheetResult.exactHit}`);
    log(`  緩和一致:     ${sheetResult.lowerHit}`);
    log(`  設定済み:     ${sheetResult.alreadySet}`);
    log(`  空行:         ${sheetResult.emptyRow}`);
    log(`  アンマッチ:   ${sheetResult.unmatched.length}`);
    if (sheetResult.unmatched.length > 0) {
      log(`  --- アンマッチ一覧（空欄のまま残す） ---`);
      for (const u of sheetResult.unmatched) log(`    ${u}`);
    }

    result.sheets.push(sheetResult);

    if (apply && (sheetResult.exactHit + sheetResult.lowerHit > 0 || needHeader)) {
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
        log(`グリッドを ${colCount} 列 → ${spec.uidIdx + 1} 列に拡張しました`);
      }

      const cUid = indexToColumnLetter(spec.uidIdx);
      if (needHeader) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: appSpreadsheetId,
          range: `${spec.name}!${cUid}1`,
          valueInputOption: "RAW",
          requestBody: { values: [["albumUid"]] },
        });
        log(`ヘッダー "albumUid" を ${cUid}1 に書き込みました`);
      }

      if (dataRows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: appSpreadsheetId,
          range: `${spec.name}!${cUid}2:${cUid}${dataRows.length + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: columnValues },
        });
      }
      log(`完了: ${sheetResult.exactHit + sheetResult.lowerHit} 行に albumUid を書き込みました`);
    } else if (apply) {
      log("書き込みなし。");
    }
  }

  return result;
}
