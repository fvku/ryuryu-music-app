/**
 * スプレッドシートのヘッダー行を元に列インデックスを動的に解決するユーティリティ。
 * 列の追加・移動があっても列名が変わらない限り正しく動作します。
 */

/** ヘッダー行（row[0]）から「列名 → 0始まりインデックス」マップを生成 */
export function buildHeaderMap(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  (headerRow ?? []).forEach((cell, i) => {
    const name = (cell ?? "").trim();
    if (name) map[name] = i;
  });
  return map;
}

/** requiredのうちmapに存在しない列名を返す */
export function findMissingColumns(
  map: Record<string, number>,
  required: string[]
): string[] {
  return required.filter((name) => !(name in map));
}

/** 0始まりインデックス → スプレッドシート列文字（A, B, ..., Z, AA, AB, ...） */
export function indexToColumnLetter(index: number): string {
  if (index < 26) return String.fromCharCode(index + 65);
  return (
    String.fromCharCode(Math.floor(index / 26) + 64) +
    String.fromCharCode((index % 26) + 65)
  );
}

/**
 * スプレッドシートの列名定数。
 * 実際のヘッダー行の文字列と完全一致している必要があります。
 *
 * ★ 書き込み対象列（WRITE_COLS）: 不一致の場合は書き込みがブロックされます。
 * ★ 読み取り専用列（READ_COLS）: 不一致の場合は空文字になります（要確認マーク付き）。
 */
export const SHEET_COL = {
  // --- 読み取り専用 ---
  NO:          "No.",            // A列  ※要確認
  DATE:        "日付",           // B列  ※要確認
  TITLE:       "アルバム名",     // C列  ※要確認
  ARTIST:      "アーティスト",   // D列  ※要確認
  GENRE:       "ジャンル",       // F列  ※要確認

  // --- 書き込み対象 ---
  MJ_ADOPTION: "M/J採用",        // Q列
  MJ_ASSIGN:   "ASSIGN",         // R列
  MJ_TRACK_NO: "M Number",       // S列
  MJ_TRACK:    "Track",          // T列
  MJ_TEXT:     "M/J採用（220−300）",  // U列  ※要確認: 実際の列名と合わせてください
  SPOTIFY_URL: "Spotify",        // AC列
  COVER_URL:   "spotifyカバー",  // AD列

  // --- メンバースコア列（書き込み対象） ---
  KWISOO: "Kwisoo",  // W列
  MERI:   "Meri",    // X列
  KOHEI:  "Kohei",   // Y列
  EDDIE:  "Eddie",   // Z列
  HANAWA: "Hanawa",  // AA列
} as const;

/** 読み取り専用列のフォールバック（header名が不一致の場合に使う 0始まりインデックス） */
export const SHEET_COL_FALLBACK: Partial<Record<keyof typeof SHEET_COL, number>> = {
  NO:     0,
  DATE:   1,
  TITLE:  2,
  ARTIST: 3,
  GENRE:  5,
};

/** 列を取得。header mapで見つからない場合はfallbackインデックスを使う（読み取り専用列用） */
export function getCol(
  map: Record<string, number>,
  key: keyof typeof SHEET_COL
): number {
  const name = SHEET_COL[key];
  if (name in map) return map[name];
  return SHEET_COL_FALLBACK[key] ?? -1;
}
