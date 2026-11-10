/**
 * Release Master ⇄ アプリ（scores）のレビュー同期の本体。判定は lib/review-sync.ts。
 *
 * - Release Master の手入力のうち、編集履歴（_review_edit_log）でアプリより新しいと確かめられたものだけを
 *   その記録時刻でアプリへ反映する
 * - それ以外の差分は `sync_review` シート（アプリ用スプレッドシート）へ確認待ちとして書き出す。
 *   管理画面で「シートの内容を採用」「アプリの内容を残す」を選ぶまで、どちらも書き換えない
 * - 実行のたびに確認待ちの一覧を作り直す（解消したものは消える）。初めて見つけた時刻は引き継ぐ
 */

import { google, sheets_v4 } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import { buildHeaderMap, getCol, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { EMAIL_TO_SHORT_NAME, LEGACY_NAME_TO_EMAIL, SHORT_NAME_TO_EMAIL } from "@/lib/members";
import { addScore, initScoresSheet, updateScore, clearScoreRow } from "@/lib/sheets";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import {
  AppReview, decideReviewSync, formatReviewCell, JOURNAL_SHEET, JournalEntry, parseJournalRow, parseReviewCell, ParsedReview, ReviewSyncReason,
} from "@/lib/review-sync";
import { appendReleaseMasterJournal } from "@/lib/review-journal";

export const REVIEW_QUEUE_SHEET = "sync_review";
export const REVIEW_QUEUE_HEADERS = [
  "key", "albumUid", "memberEmail", "reason", "rmValue", "appScore", "appComment", "appSubmittedAt",
  "rmRecordedAt", "albumNo", "albumTitle", "artistName", "firstSeenAt", "lastSeenAt",
] as const;

export interface ReviewQueueItem {
  key: string;
  albumUid: string;
  memberEmail: string;
  reason: ReviewSyncReason;
  rmValue: string;
  app: AppReview | null;
  rmRecordedAt: string | null;
  albumNo: string;
  albumTitle: string;
  artistName: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface RmCell {
  albumUid: string;
  albumNo: string;
  albumTitle: string;
  artistName: string;
  memberEmail: string;
  shortName: string;
  value: string;
  cellA1: string;
}

interface AppRow extends AppReview {
  albumUid: string;
  albumTitle: string;
  artistName: string;
}

function sheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getGoogleAuth(true) });
}

function normalizeEmail(memberName: string): string {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (lower in EMAIL_TO_SHORT_NAME) return lower;
  return LEGACY_NAME_TO_EMAIL[lower] ?? lower;
}

export interface ReviewSyncState {
  cells: RmCell[];
  appByKey: Map<string, AppRow>;
  journalByKey: Map<string, JournalEntry[]>;
  journalAvailable: boolean;
}

/** uid×member（とUIDの無い旧行のための title×artist×member）の索引を作る */
function appKeyByUid(uid: string, email: string) {
  return `${uid}::${email}`;
}
function appKeyByTitle(title: string, artist: string, email: string) {
  return `t::${title.trim()}::${artist.trim()}::${email}`;
}

export async function readReviewSyncState(sheets = sheetsClient()): Promise<ReviewSyncState> {
  const rmId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  const appId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!rmId || !appId) throw new Error("スプレッドシートIDが設定されていません");

  const [rmRes, scoresRes, journalRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: rmId, range: "'Release Master'!A1:AZ" }),
    sheets.spreadsheets.values.get({ spreadsheetId: appId, range: "scores!A2:H" }),
    sheets.spreadsheets.values.get({ spreadsheetId: rmId, range: `${JOURNAL_SHEET}!A2:N` }).catch(() => null),
  ]);

  const [header = [], ...rows] = rmRes.data.values ?? [];
  const col = buildHeaderMap(header);
  const uidIdx = col[SHEET_COL.UID];
  const cells: RmCell[] = [];
  rows.forEach((row, i) => {
    const albumNo = (row[getCol(col, "NO")] ?? "").trim();
    const albumTitle = (row[getCol(col, "TITLE")] ?? "").trim();
    const artistName = (row[getCol(col, "ARTIST")] ?? "").trim();
    const albumUid = uidIdx !== undefined ? (row[uidIdx] ?? "").trim() : "";
    if (!albumNo || !albumTitle || !albumUid) return; // UID未採番の行は採番後の実行で扱う
    for (const [shortName, email] of Object.entries(SHORT_NAME_TO_EMAIL)) {
      const idx = col[shortName];
      if (idx === undefined) continue;
      cells.push({
        albumUid, albumNo, albumTitle, artistName, memberEmail: email, shortName,
        value: (row[idx] ?? "").trim(),
        cellA1: `${indexToColumnLetter(idx)}${i + 2}`,
      });
    }
  });

  // アプリ側はメンバーごとに最新の1件
  const appByKey = new Map<string, AppRow>();
  for (const r of scoresRes.data.values ?? []) {
    if (!r[0]) continue;
    const email = normalizeEmail(r[1] ?? "");
    const row: AppRow = {
      score: r[2] !== "" && r[2] !== undefined ? parseFloat(r[2]) : null,
      comment: r[3] ?? "",
      submittedAt: r[4] ?? "",
      albumTitle: r[5] ?? "",
      artistName: r[6] ?? "",
      albumUid: (r[7] ?? "").trim(),
    };
    for (const key of [row.albumUid ? appKeyByUid(row.albumUid, email) : null, appKeyByTitle(row.albumTitle, row.artistName, email)]) {
      if (!key) continue;
      const existing = appByKey.get(key);
      if (!existing || row.submittedAt > existing.submittedAt) appByKey.set(key, row);
    }
  }

  const journalByKey = new Map<string, JournalEntry[]>();
  for (const r of journalRes?.data.values ?? []) {
    const e = parseJournalRow(r);
    if (!e) continue;
    const key = appKeyByUid(e.albumUid, e.memberEmail);
    journalByKey.set(key, [...(journalByKey.get(key) ?? []), e]);
  }

  return { cells, appByKey, journalByKey, journalAvailable: journalRes !== null };
}

function appFor(state: ReviewSyncState, cell: RmCell): AppRow | null {
  return state.appByKey.get(appKeyByUid(cell.albumUid, cell.memberEmail))
    ?? state.appByKey.get(appKeyByTitle(cell.albumTitle, cell.artistName, cell.memberEmail))
    ?? null;
}

export interface ReviewSyncPlan {
  apply: { cell: RmCell; review: ParsedReview; submittedAt: string; hasApp: boolean }[];
  review: Omit<ReviewQueueItem, "firstSeenAt" | "lastSeenAt">[];
}

export function planReviewSync(state: ReviewSyncState): ReviewSyncPlan {
  const plan: ReviewSyncPlan = { apply: [], review: [] };
  for (const cell of state.cells) {
    const app = appFor(state, cell);
    if (!cell.value && !app) continue;
    const decision = decideReviewSync(cell.value, app, state.journalByKey.get(appKeyByUid(cell.albumUid, cell.memberEmail)) ?? []);
    if (decision.action === "apply_rm") {
      plan.apply.push({ cell, review: decision.review, submittedAt: decision.submittedAt, hasApp: !!app });
    } else if (decision.action === "review") {
      plan.review.push({
        key: appKeyByUid(cell.albumUid, cell.memberEmail),
        albumUid: cell.albumUid, memberEmail: cell.memberEmail, reason: decision.reason,
        rmValue: cell.value, app: app ? { score: app.score, comment: app.comment, submittedAt: app.submittedAt } : null,
        rmRecordedAt: decision.rmRecordedAt, albumNo: cell.albumNo, albumTitle: cell.albumTitle, artistName: cell.artistName,
      });
    }
  }
  return plan;
}

async function applyRmToApp(item: ReviewSyncPlan["apply"][number] | { cell: RmCell; review: ParsedReview; submittedAt: string; hasApp: boolean }) {
  const { cell, review, submittedAt, hasApp } = item;
  const altNames = Object.entries(LEGACY_NAME_TO_EMAIL).filter(([, e]) => e === cell.memberEmail).map(([n]) => n);
  if (hasApp) {
    const updated = await updateScore(cell.albumTitle, cell.artistName, cell.memberEmail, review.score, review.comment, altNames, submittedAt, cell.albumUid);
    if (updated) return;
  }
  await addScore({
    reviewId: cell.albumNo, memberName: cell.memberEmail, score: review.score, comment: review.comment,
    albumTitle: cell.albumTitle, artistName: cell.artistName, albumUid: cell.albumUid, submittedAt,
  });
}

// ── 確認待ちシート ──

async function readQueueRows(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<string[][] | null> {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${REVIEW_QUEUE_SHEET}!A1:N` });
    return res.data.values ?? [];
  } catch {
    return null; // シートが無い
  }
}

function rowToQueueItem(r: string[]): ReviewQueueItem | null {
  const [key, albumUid, memberEmail, reason, rmValue, appScore, appComment, appSubmittedAt, rmRecordedAt, albumNo, albumTitle, artistName, firstSeenAt, lastSeenAt] = r;
  if (!key || !albumUid || !memberEmail) return null;
  const hasApp = appSubmittedAt !== undefined && appSubmittedAt !== "" || (appComment ?? "") !== "" || (appScore ?? "") !== "";
  return {
    key, albumUid, memberEmail, reason: reason as ReviewSyncReason, rmValue: rmValue ?? "",
    app: hasApp ? { score: appScore ? parseFloat(appScore) : null, comment: appComment ?? "", submittedAt: appSubmittedAt ?? "" } : null,
    rmRecordedAt: rmRecordedAt || null, albumNo: albumNo ?? "", albumTitle: albumTitle ?? "", artistName: artistName ?? "",
    firstSeenAt: firstSeenAt ?? "", lastSeenAt: lastSeenAt ?? "",
  };
}

export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const appId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!appId) return [];
  const rows = await readQueueRows(sheetsClient(), appId);
  return (rows ?? []).slice(1).map(rowToQueueItem).filter((x): x is ReviewQueueItem => !!x);
}

async function writeQueue(sheets: sheets_v4.Sheets, spreadsheetId: string, items: Omit<ReviewQueueItem, "firstSeenAt" | "lastSeenAt">[], now: string) {
  let existingRows = await readQueueRows(sheets, spreadsheetId);
  if (existingRows === null) {
    if (items.length === 0) return;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: REVIEW_QUEUE_SHEET } } }] },
    });
    existingRows = [];
  }
  // 同じ差分（キー＋シートの値＋アプリの値）を前から見ていれば、初めて見つけた時刻を引き継ぐ
  const signature = (key: string, rmValue: string, appScore: string, appComment: string) => `${key}\u0000${rmValue}\u0000${appScore}\u0000${appComment}`;
  const firstSeen = new Map<string, string>();
  for (const r of existingRows.slice(1)) {
    if (r[0]) firstSeen.set(signature(r[0], r[4] ?? "", r[5] ?? "", r[6] ?? ""), r[12] ?? "");
  }
  const values: string[][] = [[...REVIEW_QUEUE_HEADERS]];
  for (const it of items) {
    const appScore = it.app?.score === null || it.app?.score === undefined ? "" : String(it.app.score);
    const appComment = it.app?.comment ?? "";
    values.push([
      it.key, it.albumUid, it.memberEmail, it.reason, it.rmValue, appScore, appComment, it.app?.submittedAt ?? "",
      it.rmRecordedAt ?? "", it.albumNo, it.albumTitle, it.artistName,
      firstSeen.get(signature(it.key, it.rmValue, appScore, appComment)) || now, now,
    ]);
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${REVIEW_QUEUE_SHEET}!A:N` });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${REVIEW_QUEUE_SHEET}!A1:N${values.length}`, valueInputOption: "RAW", requestBody: { values },
  });
}

export interface ReviewSyncResult {
  applied: { key: string; submittedAt: string }[];
  reviewCount: number;
  reviewByReason: Partial<Record<ReviewSyncReason, number>>;
  journalAvailable: boolean;
}

/** 同期を1回実行する。apply=false なら何も書かずに計画だけ返す */
export async function runReviewSync({ apply }: { apply: boolean }): Promise<ReviewSyncResult> {
  const sheets = sheetsClient();
  const state = await readReviewSyncState(sheets);
  const plan = planReviewSync(state);
  const reviewByReason: Partial<Record<ReviewSyncReason, number>> = {};
  for (const r of plan.review) reviewByReason[r.reason] = (reviewByReason[r.reason] ?? 0) + 1;

  if (apply) {
    if (plan.apply.length > 0) {
      await initScoresSheet();
      for (const item of plan.apply) await applyRmToApp(item);
      invalidateCache(CACHE_KEY.SCORES);
    }
    await writeQueue(sheets, process.env.GOOGLE_SPREADSHEET_ID!, plan.review, new Date().toISOString());
  }
  return {
    applied: plan.apply.map((a) => ({ key: appKeyByUid(a.cell.albumUid, a.cell.memberEmail), submittedAt: a.submittedAt })),
    reviewCount: plan.review.length,
    reviewByReason,
    journalAvailable: state.journalAvailable,
  };
}

export type ResolveAction = "adopt_rm" | "keep_app";

/**
 * 管理画面からの確認待ちの解消。
 * 画面に出ていた値（expected）と今のシートの値が違えば、別の変更が入ったので何もせずに知らせる。
 * - adopt_rm: Release Master の内容をアプリへ（空セルならアプリのレビューを消す）。時刻は履歴があればその時刻、無ければ今
 * - keep_app: アプリの内容を Release Master へ書き戻し、アプリの書き込みとして履歴に残す
 */
export async function resolveReviewQueueItem(input: {
  key: string;
  action: ResolveAction;
  expected: { rmValue: string; appSubmittedAt: string };
  actorEmail: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sheets = sheetsClient();
  const state = await readReviewSyncState(sheets);
  const cell = state.cells.find((c) => appKeyByUid(c.albumUid, c.memberEmail) === input.key);
  if (!cell) return { ok: false, error: "対象のアルバムが見つかりません（UIDが変わった可能性があります）" };
  const app = appFor(state, cell);
  if (cell.value !== input.expected.rmValue || (app?.submittedAt ?? "") !== input.expected.appSubmittedAt) {
    return { ok: false, error: "表示した後に内容が変わりました。一覧を読み込み直してください" };
  }
  const now = new Date().toISOString();

  if (input.action === "adopt_rm") {
    const journal = state.journalByKey.get(input.key) ?? [];
    const latest = journal.filter((e) => e.value.trim() === cell.value).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    const submittedAt = latest?.recordedAt ?? now;
    if (!cell.value) {
      if (app) await clearScoreRow(cell.albumUid, cell.albumTitle, cell.artistName, cell.memberEmail);
    } else {
      const review = parseReviewCell(cell.value);
      if (!review) {
        return { ok: false, error: "シートの値をレビューとして読めません（スコアが0〜10の範囲外など）" };
      }
      await initScoresSheet();
      await applyRmToApp({ cell, review, submittedAt, hasApp: !!app });
    }
    invalidateCache(CACHE_KEY.SCORES);
  } else {
    if (!app) return { ok: false, error: "アプリにレビューがありません" };
    const value = formatReviewCell(app.score, app.comment);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.RELEASE_MASTER_SPREADSHEET_ID!,
      range: `'Release Master'!${cell.cellA1}`,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    });
    await appendReleaseMasterJournal(sheets, [{
      operationId: `resolve-${now}`, recordedAt: now, albumUid: cell.albumUid, memberEmail: cell.memberEmail,
      value, previous: cell.value, cellA1: cell.cellA1, albumNo: cell.albumNo, albumTitle: cell.albumTitle, artistName: cell.artistName,
    }]);
    invalidateCache(CACHE_KEY.RELEASE_MASTER);
  }

  // 一覧から外す（次の同期でも差分が無ければ出てこない）
  const rest = (await getReviewQueue()).filter((it) => it.key !== input.key);
  await writeQueue(sheets, process.env.GOOGLE_SPREADSHEET_ID!, rest, now);
  return { ok: true };
}
