/**
 * Weekly（金曜19時投稿）の対象週の計算。
 *
 * 1週は「土曜〜金曜」。金曜の投稿では、直前の土曜から当日金曜までの新譜を扱う
 * （lib/generator/source.ts の weeklyReleaseWindow と同じ定義）。
 * 日付は "YYYY-MM-DD"（UTCの暦日として扱う）で受け渡し、
 * Release Master の Date列（"YYYY/MM/DD"）とは toSheetDate で相互変換する。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 日本時間の今日を "YYYY-MM-DD" で返す */
export function todayInTokyo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * 作業対象の金曜日。今日が金曜ならその日、それ以外は次に来る金曜。
 * 土曜に開いたら翌週分の準備が始まる、という運用に合わせている。
 */
export function upcomingFriday(today: string): string {
  const date = parseIsoDate(today);
  if (!date) throw new Error(`日付の形式が不正です: ${today}`);
  const daysUntilFriday = (5 - date.getUTCDay() + 7) % 7;
  return toIso(new Date(date.getTime() + daysUntilFriday * DAY_MS));
}

export function isFriday(value: string): boolean {
  return parseIsoDate(value)?.getUTCDay() === 5;
}

/** 金曜日を n 週ずらす */
export function shiftWeek(friday: string, weeks: number): string {
  const date = parseIsoDate(friday);
  if (!date) throw new Error(`日付の形式が不正です: ${friday}`);
  return toIso(new Date(date.getTime() + weeks * 7 * DAY_MS));
}

export interface WeekWindow {
  /** 投稿する金曜日（"YYYY-MM-DD"） */
  friday: string;
  /** 直前の土曜日（"YYYY-MM-DD"、この日を含む） */
  saturday: string;
  /** Release Master の Date列と比較するための範囲（両端を含む、"YYYY/MM/DD"） */
  sheetFrom: string;
  sheetTo: string;
}

export function weekWindow(friday: string): WeekWindow {
  const date = parseIsoDate(friday);
  if (!date || date.getUTCDay() !== 5) throw new Error(`対象週は金曜日で指定してください: ${friday}`);
  const saturday = toIso(new Date(date.getTime() - 6 * DAY_MS));
  return { friday, saturday, sheetFrom: toSheetDate(saturday), sheetTo: toSheetDate(friday) };
}

/** "YYYY-MM-DD" → "YYYY/MM/DD" */
export function toSheetDate(iso: string): string {
  return iso.replace(/-/g, "/");
}

/**
 * Release Master の Date列の値を "YYYY/MM/DD" に揃える。
 * 表示形式の違い（"2026/9/5"）を吸収し、読めなければ空文字を返す。
 */
export function normalizeSheetDate(value: string): string {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec((value ?? "").trim());
  if (!m) return "";
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

/** Release Master の Date列で絞る範囲（"YYYY/MM/DD"、両端を含む） */
export interface SheetDateRange { from: string; to: string; }

export function isInSheetDateRange(sheetDate: string, range: SheetDateRange): boolean {
  const date = normalizeSheetDate(sheetDate);
  return !!date && date >= range.from && date <= range.to;
}

/** Release Master の Date列の値がこの週に入っているか */
export function isInWeek(sheetDate: string, window: WeekWindow): boolean {
  return isInSheetDateRange(sheetDate, { from: window.sheetFrom, to: window.sheetTo });
}

/** 「9/26（土）〜10/2（金）」のような表示用ラベル */
export function weekLabel(window: WeekWindow): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(window.saturday)}（土）〜${fmt(window.friday)}（金）`;
}
