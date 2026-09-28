/**
 * AOTY（albumoftheyear.org/upcoming/）のページを全選択コピーしたテキストを、
 * Release Master に入れる「日付・アルバム名・アーティスト名」に分解する。
 *
 * AOTY はサーバーからの取得を Cloudflare で弾く（403）ので、
 * 人がブラウザでコピーしたテキストを受け取る形にしている。
 *
 * ページ上の1作品は「アーティスト名 → アルバム名 → "Oct 2 • LP"」の順に並ぶ
 * （旧 weekly_scraper.py が読んでいた div.artistTitle / div.albumTitle / div.type と同じ並び）。
 * そこで日付の行を目印にし、その直前の2行をアーティスト名・アルバム名として拾う。
 * ページの見出しやボタンの文言などの雑音は、日付行に挟まれない限り無視される。
 *
 * 旧来のClaude整形結果（"2026/10/02<TAB>アルバム名<TAB>アーティスト名"）もそのまま受け付ける。
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "Oct 2 • LP" / "Oct 2" / "October 2, 2026 • EP"
 *
 * 区切りは「•」だけ、種別は短い英単語だけを認める。ライブ盤の作品名に
 * "Oct. 3, 2026 | Boardwalk Hall, ..." のような日付入りのものがあり（Phish）、
 * 条件が緩いとそれを日付行と取り違えて前後の作品がずれる（2026-09-28 実データで確認）
 */
const DATE_LINE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s*[•·]\s*([a-z][a-z ]{0,20}))?$/i;

/** 整形済みの "YYYY/MM/DD<TAB>Title<TAB>Artist" */
const TSV_LINE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\t([^\t]+)\t([^\t]+)/;

/** 作品名・アーティスト名になり得ない行（件数・バッジ・ボタン等） */
const NOISE_LINE = /^(\d[\d,.]*|must hear|new|add|add to list|more|view all|see all|load more|\d+\s*(comments?|ratings?|reviews?))$/i;

export interface AotyEntry {
  /** "YYYY-MM-DD"。年が書かれていなければ基準日に最も近い年で補う */
  date: string;
  title: string;
  artist: string;
  /** AOTY の種別（LP / EP / Mixtape / Compilation / Live ...）。無ければ空 */
  type: string;
  /** 対象外と判断した理由。null なら取り込み候補 */
  excludeReason: string | null;
}

/**
 * 種別による除外。オリジナルアルバムだけを対象にする（2026-09-28 Kohei）。
 * 洋楽のEPはこれまでも取り込んでいない（Weeklyの実運用でEPは邦楽のみ）。
 */
const EXCLUDED_TYPES: Record<string, string> = {
  ep: "EP",
  single: "シングル",
  compilation: "コンピレーション",
  live: "ライブ盤",
  remix: "リミックス",
  soundtrack: "サウンドトラック",
  reissue: "リイシュー",
  "box set": "ボックスセット",
  "dj mix": "DJミックス",
  demo: "デモ集",
};

/** 作品名による除外。デラックス版・再発・ライブ盤などは種別がLPのまま載ることがある */
const EXCLUDED_TITLE_PATTERNS: [RegExp, string][] = [
  [/\bdeluxe\b/i, "デラックス版"],
  [/\bexpanded\b|\(extended\)/i, "拡張版"],
  [/\bcover album\b/i, "カバー集"],
  [/\bremaster(ed)?\b/i, "リマスター"],
  [/\breissue\b/i, "リイシュー"],
  [/\banniversary\b/i, "記念盤"],
  [/\bedition\b/i, "別エディション"],
  [/\blive (at|from|in|on)\b|\(live\)|\[live\]|\blive$/i, "ライブ盤"],
  [/\bremix(es|ed)?\b/i, "リミックス"],
  [/\bgreatest hits\b|\bbest of\b|\banthology\b|\bcollection\b/i, "ベスト盤"],
  [/\bcompilation\b/i, "コンピレーション"],
  [/\bb-sides\b|\bdemos\b|\binstrumentals?\b/i, "未発表・別テイク集"],
];

export function excludeReasonFor(title: string, type: string): string | null {
  const typeKey = type.trim().toLowerCase();
  if (typeKey && EXCLUDED_TYPES[typeKey]) return EXCLUDED_TYPES[typeKey];
  for (const [pattern, reason] of EXCLUDED_TITLE_PATTERNS) {
    if (pattern.test(title)) return reason;
  }
  return null;
}

/** 年の無い月日に、基準日（対象の金曜日）に最も近い年を補う */
function inferDate(month: number, day: number, year: number | null, reference: string): string | null {
  const refYear = Number(reference.slice(0, 4));
  const candidates = year ? [year] : [refYear - 1, refYear, refYear + 1];
  const refTime = Date.parse(`${reference}T00:00:00Z`);
  let best: { iso: string; distance: number } | null = null;
  for (const y of candidates) {
    const date = new Date(Date.UTC(y, month - 1, day));
    if (date.getUTCMonth() !== month - 1) continue; // 2/30 など
    const distance = Math.abs(date.getTime() - refTime);
    if (!best || distance < best.distance) best = { iso: date.toISOString().slice(0, 10), distance };
  }
  return best?.iso ?? null;
}

function cleanLine(line: string): string {
  return line.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

export interface ParseAotyResult {
  entries: AotyEntry[];
  /** 日付行は見つかったが、直前にアーティスト名・作品名が揃っていなかった数 */
  skipped: number;
}

/**
 * @param text 貼り付けられたテキスト
 * @param reference 年の補完に使う基準日（対象の金曜日、"YYYY-MM-DD"）
 */
export function parseAotyText(text: string, reference: string): ParseAotyResult {
  const lines = (text ?? "").split(/\r?\n/).map(cleanLine).filter(Boolean);
  const rawLines = (text ?? "").split(/\r?\n/);
  const entries: AotyEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const push = (entry: Omit<AotyEntry, "excludeReason">) => {
    const key = `${entry.title.toLowerCase()}::${entry.artist.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, excludeReason: excludeReasonFor(entry.title, entry.type) });
  };

  // 整形済み（タブ区切り）の行が含まれていれば、そちらを優先して読む
  const tsvRows = rawLines.map((l) => TSV_LINE.exec(l.trim())).filter((m): m is RegExpExecArray => !!m);
  if (tsvRows.length > 0) {
    for (const m of tsvRows) {
      const date = inferDate(Number(m[2]), Number(m[3]), Number(m[1]), reference);
      if (!date) { skipped++; continue; }
      const rawTitle = cleanLine(m[4]);
      const isEp = /^\[EP\]\s*/i.test(rawTitle);
      push({ date, title: rawTitle.replace(/^\[EP\]\s*/i, ""), artist: cleanLine(m[5]), type: isEp ? "EP" : "" });
    }
    return { entries, skipped };
  }

  let blockStart = 0; // 直前の日付行の次の行。作品同士の行が混ざらないようにする
  for (let i = 0; i < lines.length; i++) {
    const m = DATE_LINE.exec(lines[i]);
    if (!m) continue;

    const content: string[] = [];
    for (let j = i - 1; j >= blockStart && content.length < 2; j--) {
      if (NOISE_LINE.test(lines[j])) continue;
      content.unshift(lines[j]);
    }
    blockStart = i + 1;

    const date = inferDate(MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : null, reference);
    if (content.length < 2 || !date) { skipped++; continue; }

    push({ date, artist: content[0], title: content[1], type: (m[4] ?? "").trim() });
  }

  return { entries, skipped };
}
