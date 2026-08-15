/**
 * Release Master の全行に安定ID（UID）を採番するコアロジック。
 * scripts/assign-uids.ts（CLI）と app/api/admin/assign-uids（管理画面）の共通実装。
 *
 * 週次で正式リリース日より前に行を先回り登録する運用があるため、
 * Spotify URL列（AD列）が埋まっている行＝内容確定済みの行のみを採番対象にする
 * （requireSpotifyUrl=falseで無効化可能だがデフォルトtrue）。
 * URLが空の行は「まだ確定していない」とみなしスキップし、pendingDetailsで報告する。
 */

import { google } from "googleapis";
import { generateAlbumUid } from "@/lib/uid";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

export interface AssignUidsOptions {
  /** false = dry-run（書き込まない） */
  apply: boolean;
  /** Spotify URL列が埋まっている行のみ採番対象にする（内容確定の目印。既定true） */
  requireSpotifyUrl?: boolean;
  log?: (msg: string) => void;
}

export interface AssignUidsRowInfo {
  row: number;
  no: string;
  title: string;
  artist: string;
}

export interface AssignUidsResult {
  total: number;
  assigned: number;
  skippedHasUid: number;
  skippedEmpty: number;
  skippedNoSpotifyUrl: number;
  assignedDetails: AssignUidsRowInfo[];
  pendingDetails: AssignUidsRowInfo[];
}

export async function assignUids(options: AssignUidsOptions): Promise<AssignUidsResult> {
  const { apply, requireSpotifyUrl = true, log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  log("シートを読み込み中...");
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const noIdx      = col["No."]  ?? 0;
  const titleIdx   = col["Title"]  ?? col["アルバム名"]  ?? 2;
  const artistIdx  = col["Artist"] ?? col["アーティスト"] ?? 3;
  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];

  if (requireSpotifyUrl && spotifyIdx === undefined) {
    throw new Error(`${SHEET_COL.SPOTIFY_URL} 列が見つかりません`);
  }

  // UID列: 既存ならそのインデックス、なければ「全行でデータが一切ない」最初の列に新設
  let uidIdx = col[SHEET_COL.UID];
  const needHeader = uidIdx === undefined;
  if (needHeader) {
    const maxRowLen = Math.max(headerRow.length, ...dataRows.map((r) => r.length));
    uidIdx = maxRowLen;
    log(`UID列が存在しないため ${indexToColumnLetter(uidIdx)} 列に新設します（既存データのない最初の列）`);
  } else {
    log(`UID列: ${indexToColumnLetter(uidIdx)} 列（既存）`);
  }
  const cUid = indexToColumnLetter(uidIdx);

  // 既存UIDの重複チェック用セット
  const usedUids = new Set<string>();
  for (const row of dataRows) {
    const u = (row[uidIdx] ?? "").trim();
    if (u) {
      if (usedUids.has(u)) throw new Error(`既存UIDに重複があります: ${u}（手動確認が必要）`);
      usedUids.add(u);
    }
  }

  const result: AssignUidsResult = {
    total: dataRows.length,
    assigned: 0,
    skippedHasUid: 0,
    skippedEmpty: 0,
    skippedNoSpotifyUrl: 0,
    assignedDetails: [],
    pendingDetails: [],
  };

  const columnValues: string[][] = dataRows.map((row, i) => {
    const rowInfo: AssignUidsRowInfo = {
      row: i + 2,
      no: (row[noIdx] ?? "").trim(),
      title: (row[titleIdx] ?? "").trim(),
      artist: (row[artistIdx] ?? "").trim(),
    };

    const existing = (row[uidIdx!] ?? "").trim();
    if (existing) { result.skippedHasUid++; return [existing]; }

    const hasContent = rowInfo.title || rowInfo.artist;
    if (!hasContent) { result.skippedEmpty++; return [""]; }

    if (requireSpotifyUrl) {
      const spotifyUrl = (row[spotifyIdx!] ?? "").trim();
      if (!spotifyUrl) {
        result.skippedNoSpotifyUrl++;
        result.pendingDetails.push(rowInfo);
        return [""];
      }
    }

    let uid = generateAlbumUid();
    while (usedUids.has(uid)) uid = generateAlbumUid();
    usedUids.add(uid);
    result.assigned++;
    result.assignedDetails.push(rowInfo);
    return [uid];
  });

  log(`\n対象データ行: ${result.total}`);
  log(`  新規採番:       ${result.assigned}`);
  log(`  採番済み:       ${result.skippedHasUid}`);
  log(`  空行スキップ:   ${result.skippedEmpty}`);
  log(`  URL未確定スキップ: ${result.skippedNoSpotifyUrl}`);

  if (!apply) {
    log("\n(dry-run) 書き込みは行われていません");
    return result;
  }

  if (needHeader) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = meta.data.sheets?.find((s) => s.properties?.title === "Release Master");
    const sheetId = sheet?.properties?.sheetId;
    const colCount = sheet?.properties?.gridProperties?.columnCount ?? 0;
    if (sheetId !== undefined && uidIdx >= colCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: uidIdx - colCount + 1 } }],
        },
      });
      log(`グリッドを ${colCount} 列 → ${uidIdx + 1} 列に拡張しました`);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Release Master'!${cUid}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[SHEET_COL.UID]] },
    });
    log(`ヘッダー "${SHEET_COL.UID}" を ${cUid}1 に書き込みました`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Release Master'!${cUid}2:${cUid}${dataRows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: columnValues },
  });

  log(`\n完了: ${result.assigned} 行に採番しました`);
  return result;
}
