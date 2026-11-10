/**
 * Release Master（手入力）とアプリ（scores シート）のレビューを、記録時刻の新しい方で揃えるための判定。
 *
 * - 比較単位は albumUid × メンバー（タイトル変更で別レビューを作らない）
 * - Release Master の編集時刻は、同じファイルの `_review_edit_log`（apps-script/ReviewJournal.gs と
 *   アプリ自身の書き込み記録）だけを根拠にする。履歴が無い・セルと履歴が食い違う差分は時刻不明として
 *   自動では反映せず、確認待ちにする（検出した時刻を編集時刻の代わりに使わない）
 * - 同時刻で内容が違う・時刻を確かめられないものは、両方を残して確認待ちにする
 *
 * ここは純粋な関数だけ。シートの読み書きは lib/ops/review-sync.ts。
 */

export const JOURNAL_SHEET = "_review_edit_log";
export const JOURNAL_HEADERS = [
  "schemaVersion", "eventId", "recordedAt", "albumUid", "memberEmail",
  "valueJson", "previousValueJson", "observedValueJson", "captureKind", "status",
  "cellA1", "albumNoJson", "albumTitleJson", "artistNameJson",
] as const;

export interface ParsedReview {
  score: number | null;
  comment: string;
}

/**
 * Release Master のセル（"7.5 コメント" / "8" / "7+ 良い" / "コメントだけ"）を読む。
 * スコアの取り出しは平均点の計算（parseLegacyScoreNum）と同じく「先頭の語を parseFloat」に揃える。
 * "7+ 良い" は7、"6.5曲単位では…" は6.5。ここを変えると、既存のアプリのレビューと大量に食い違って見える。
 * 先頭の語が数値でなければ全体をコメントとして扱う（旧同期は先頭の1語を落としていた）。
 * 範囲外の数値（例 "90sの…"）は誤入力・本文の可能性が高いので null を返し、同期の対象から外す。
 */
export function parseReviewCell(value: string): ParsedReview | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { score: null, comment: "" };
  const spaceIdx = trimmed.search(/\s/);
  const head = spaceIdx === -1 ? trimmed : trimmed.substring(0, spaceIdx);
  const num = parseFloat(head);
  if (Number.isNaN(num)) return { score: null, comment: trimmed };
  if (num < 0 || num > 10) return null;
  return { score: num, comment: spaceIdx === -1 ? "" : trimmed.substring(spaceIdx + 1).trim() };
}

/** アプリのレビューを Release Master のセルの書式にする。スコアなしはコメントだけ（空なら空セル） */
export function formatReviewCell(score: number | null, comment: string): string {
  const c = (comment ?? "").trim();
  if (score === null || score === undefined) return c;
  return c ? `${score} ${c}` : `${score}`;
}

export function sameReview(a: ParsedReview, b: ParsedReview): boolean {
  return a.score === b.score && a.comment.trim() === b.comment.trim();
}

export interface JournalEntry {
  recordedAt: string;
  albumUid: string;
  memberEmail: string;
  value: string;
  captureKind: string;
  status: string;
}

export interface AppReview {
  score: number | null;
  comment: string;
  submittedAt: string;
}

export type ReviewSyncReason =
  /** Release Master に差分があるが、編集履歴が無い（または履歴とセルが食い違う）ので時刻が分からない */
  | "time_unknown"
  /** アプリの方が新しい。Release Master への反映が抜けている */
  | "app_newer"
  /** 同じ記録時刻で内容が違う */
  | "same_time_conflict"
  /** Release Master でセルが消された（アプリには残っている） */
  | "rm_cleared"
  /** 履歴自体に要確認の印がある（一括貼り付け・UID不正など） */
  | "needs_review";

export type ReviewSyncDecision =
  | { action: "none" }
  | { action: "apply_rm"; review: ParsedReview; submittedAt: string }
  | { action: "review"; reason: ReviewSyncReason; rmRecordedAt: string | null };

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** 同じ uid×member の履歴から最新のものを返す。最新時刻が複数あって値が違えば ambiguous */
export function latestJournal(entries: JournalEntry[]): { entry: JournalEntry | null; ambiguous: boolean } {
  let best: JournalEntry | null = null;
  let bestT = -Infinity;
  let ambiguous = false;
  for (const e of entries) {
    const t = time(e.recordedAt);
    if (t === null) continue;
    if (t > bestT) {
      best = e;
      bestT = t;
      ambiguous = false;
    } else if (t === bestT && best && best.value.trim() !== e.value.trim()) {
      ambiguous = true;
    }
  }
  return { entry: best, ambiguous };
}

/**
 * 1つの uid×member について、何をするかを決める。
 * cellValue: Release Master の現在のセル / app: アプリの最新レビュー（無ければ null）/ journal: その uid×member の履歴
 */
export function decideReviewSync(cellValue: string, app: AppReview | null, journal: JournalEntry[]): ReviewSyncDecision {
  const cell = parseReviewCell(cellValue);
  if (cell === null) return { action: "none" }; // 範囲外のスコアは誤入力として扱わない（従来どおり）
  const appParsed: ParsedReview | null = app ? { score: app.score, comment: app.comment ?? "" } : null;
  const cellEmpty = cell.score === null && cell.comment === "";

  if (appParsed && sameReview(cell, appParsed)) return { action: "none" };

  const { entry: latest, ambiguous } = latestJournal(journal);

  if (cellEmpty) {
    // コメントだけのアプリレビューは Release Master に書かない仕様なので、空セルが正常
    if (!appParsed || appParsed.score === null) return { action: "none" };
    // 空セルは、履歴で「消した」ことが確かめられ、それがアプリより新しいときだけ知らせる。
    // 履歴が無い空セル（アプリ導入前のデータ・反映漏れ）は従来どおり何もしない
    if (latest && latest.value.trim() === "" && !ambiguous) {
      const rmT = time(latest.recordedAt)!;
      const appT = time(app!.submittedAt);
      if (appT === null || rmT > appT) return { action: "review", reason: "rm_cleared", rmRecordedAt: latest.recordedAt };
    }
    return { action: "none" };
  }

  if (!latest || latest.value.trim() !== cellValue.trim()) {
    // コメントだけのセルは、旧同期でもアプリへ取り込んでいなかった（メモ書きとして使われている）。
    // 履歴の無いものまで確認待ちに積むと、過去の分で埋まって見るべき差分が埋もれるので従来どおり触らない
    if (!app && !latest && cell.score === null) return { action: "none" };
    return { action: "review", reason: "time_unknown", rmRecordedAt: latest?.recordedAt ?? null };
  }
  if (ambiguous) return { action: "review", reason: "same_time_conflict", rmRecordedAt: latest.recordedAt };
  if (latest.status !== "recorded") return { action: "review", reason: "needs_review", rmRecordedAt: latest.recordedAt };

  if (!app) return { action: "apply_rm", review: cell, submittedAt: latest.recordedAt };

  const rmT = time(latest.recordedAt)!;
  const appT = time(app.submittedAt);
  if (appT === null || rmT > appT) return { action: "apply_rm", review: cell, submittedAt: latest.recordedAt };
  if (rmT < appT) return { action: "review", reason: "app_newer", rmRecordedAt: latest.recordedAt };
  return { action: "review", reason: "same_time_conflict", rmRecordedAt: latest.recordedAt };
}

/** `_review_edit_log` の1行（見出し除く）を読む。壊れた行は null */
export function parseJournalRow(row: string[]): JournalEntry | null {
  const [schemaVersion, , recordedAt, albumUid, memberEmail, valueJson, , , captureKind, status] = row;
  if (schemaVersion !== "1" || !recordedAt || !albumUid || !memberEmail) return null;
  let value: unknown;
  try {
    value = JSON.parse(valueJson ?? "");
  } catch {
    return null;
  }
  if (typeof value !== "string") return null;
  return {
    recordedAt,
    albumUid: albumUid.trim(),
    memberEmail: memberEmail.trim().toLowerCase(),
    value,
    captureKind: captureKind ?? "",
    status: status ?? "",
  };
}

/** アプリが Release Master へ書いたときの履歴行（Apps Script と同じ列） */
export function appJournalRow(input: {
  operationId: string;
  recordedAt: string;
  albumUid: string;
  memberEmail: string;
  value: string;
  previous: string | null;
  cellA1: string;
  albumNo: string;
  albumTitle: string;
  artistName: string;
}): string[] {
  const uidOk = /^[a-z0-9]{8}$/.test(input.albumUid);
  return [
    "1",
    `app:${input.operationId}:${input.cellA1}`,
    input.recordedAt,
    uidOk ? input.albumUid : "",
    input.memberEmail.toLowerCase(),
    JSON.stringify(input.value),
    JSON.stringify(input.previous),
    JSON.stringify(input.value),
    "app_write",
    uidOk ? "recorded" : "needs_review:invalid_uid",
    input.cellA1,
    JSON.stringify(input.albumNo),
    JSON.stringify(input.albumTitle),
    JSON.stringify(input.artistName),
  ];
}
