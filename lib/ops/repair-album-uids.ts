/**
 * scores / bookmarks / recommendations の albumUid が、作品名と食い違っている行を直す。
 *
 * 2026-11-10 に、レビューの albumUid が別作品の UID になっている行を本番で見つけた
 * （例: Ravyn Lenae『Blue Island』のレビューが Cornelius『Refractions』のUIDを持つ）。
 * アプリはUID優先で照合するため、別の作品の詳細にレビューが出てしまう。
 * Release Master の行を一部の列だけ並べ替えると、右端のUID列が行とずれてこうなる。
 *
 * 方針（Release Master を正とする）:
 * - 行の UID が指す Release Master の作品名・アーティスト名が、その行の作品名・アーティスト名と違うものが対象
 * - 行の作品名＋アーティスト名で Release Master を引き、ちょうど1行に決まればその UID に付け直す
 *   （完全一致を優先し、無ければ大文字小文字・前後の空白を無視して比べる）
 * - 決まらない（改名された・同名が複数）行は触らずに報告する
 * - 書き込みは UID のセルだけ。dry-run では何も書かない
 */

import { google } from "googleapis";
import { buildHeaderMap, getCol, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

interface Target { name: string; range: string; titleIdx: number; artistIdx: number; uidIdx: number }

const TARGETS: Target[] = [
  { name: "scores", range: "scores!A2:I", titleIdx: 5, artistIdx: 6, uidIdx: 7 },
  { name: "bookmarks", range: "bookmarks!A2:E", titleIdx: 1, artistIdx: 2, uidIdx: 4 },
  { name: "recommendations", range: "recommendations!A2:J", titleIdx: 3, artistIdx: 4, uidIdx: 9 },
];

export interface UidFix { sheet: string; row: number; title: string; artist: string; from: string; to: string; fromTitle: string }
export interface UidUnresolved { sheet: string; row: number; title: string; artist: string; uid: string; uidTitle: string; reason: "no_match" | "ambiguous" }

export interface RmAlbumRef { uid: string; title: string; artist: string }

const exactKey = (t: string, a: string) => `${t.trim()}\u0000${a.trim()}`;
const looseKey = (t: string, a: string) => exactKey(t.toLowerCase().replace(/\s+/g, " "), a.toLowerCase().replace(/\s+/g, " "));
/** 作品名だけの比較用（大文字小文字・空白・先頭の [EP] を無視） */
const titleKey = (t: string) => t.trim().replace(/^\[EP\]\s*/i, "").toLowerCase().replace(/\s+/g, " ");

/** 純粋関数: 1シート分の行から、付け直す行と決められない行を求める */
export function planUidRepairs(
  sheet: string,
  rows: string[][],
  spec: Pick<Target, "titleIdx" | "artistIdx" | "uidIdx">,
  rm: RmAlbumRef[]
): { fixes: UidFix[]; unresolved: UidUnresolved[] } {
  const byUid = new Map(rm.map((r) => [r.uid, r]));
  const exact = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();
  for (const r of rm) {
    exact.set(exactKey(r.title, r.artist), [...(exact.get(exactKey(r.title, r.artist)) ?? []), r.uid]);
    loose.set(looseKey(r.title, r.artist), [...(loose.get(looseKey(r.title, r.artist)) ?? []), r.uid]);
    byTitle.set(titleKey(r.title), [...(byTitle.get(titleKey(r.title)) ?? []), r.uid]);
  }
  const fixes: UidFix[] = [];
  const unresolved: UidUnresolved[] = [];
  rows.forEach((row, i) => {
    const uid = (row[spec.uidIdx] ?? "").trim();
    const title = (row[spec.titleIdx] ?? "").trim();
    const artist = (row[spec.artistIdx] ?? "").trim();
    if (!uid || !title) return;
    const current = byUid.get(uid);
    // 作品名が同じなら一致とみなす（Release Master 側でアーティスト表記や [EP] を直しただけのことが多い）
    if (current && titleKey(current.title) === titleKey(title)) return;
    // 作品名＋アーティスト名 → 作品名だけ、の順に、ちょうど1行に決まるものを探す
    const candidates = exact.get(exactKey(title, artist)) ?? loose.get(looseKey(title, artist)) ?? byTitle.get(titleKey(title)) ?? [];
    const rowNum = i + 2;
    if (candidates.length === 1) {
      if (candidates[0] !== uid) fixes.push({ sheet, row: rowNum, title, artist, from: uid, to: candidates[0], fromTitle: current?.title ?? "（Release Masterに無いUID）" });
    } else {
      unresolved.push({ sheet, row: rowNum, title, artist, uid, uidTitle: current?.title ?? "", reason: candidates.length === 0 ? "no_match" : "ambiguous" });
    }
  });
  return { fixes, unresolved };
}

export async function repairAlbumUids({ apply }: { apply: boolean }): Promise<{ fixes: UidFix[]; unresolved: UidUnresolved[] }> {
  const appId = process.env.GOOGLE_SPREADSHEET_ID;
  const rmId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!appId || !rmId) throw new Error("環境変数が設定されていません");
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(apply) });

  const rmRows = (await sheets.spreadsheets.values.get({ spreadsheetId: rmId, range: "'Release Master'!A1:AZ" })).data.values ?? [];
  const [header = [], ...data] = rmRows;
  const col = buildHeaderMap(header);
  const uidIdx = col[SHEET_COL.UID];
  if (uidIdx === undefined) throw new Error("Release Master に UID 列がありません");
  const rm: RmAlbumRef[] = data
    .map((r) => ({ uid: (r[uidIdx] ?? "").trim(), title: (r[getCol(col, "TITLE")] ?? "").trim(), artist: (r[getCol(col, "ARTIST")] ?? "").trim() }))
    .filter((r) => r.uid && r.title);

  const fixes: UidFix[] = [];
  const unresolved: UidUnresolved[] = [];
  for (const t of TARGETS) {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: appId, range: t.range })).data.values ?? [];
    const plan = planUidRepairs(t.name, rows, t, rm);
    fixes.push(...plan.fixes);
    unresolved.push(...plan.unresolved);
    if (apply && plan.fixes.length > 0) {
      const letter = indexToColumnLetter(t.uidIdx);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: appId,
        requestBody: {
          valueInputOption: "RAW",
          data: plan.fixes.map((f) => ({ range: `${t.name}!${letter}${f.row}`, values: [[f.to]] })),
        },
      });
    }
  }
  return { fixes, unresolved };
}
