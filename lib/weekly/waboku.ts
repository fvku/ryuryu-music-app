/**
 * 洋楽・邦楽が混ざったプレイリスト（New Music Friday Japan）の作品を、
 * Release Master の「洋邦」列に入れる値へ振り分ける。
 *
 * Spotify には「日本のアーティストか」を直接表す項目がないので、手がかりを強い順に見る。
 *   1. Release Master の過去の行（人が決めた値なので最優先）
 *   2. アーティスト名（共演を含む）・作品名のかな（ひらがな・カタカナ）
 *   3. アーティストのジャンル（j-pop / anime / japanese indie ...）
 *   4. レーベル（Sony Music Labels Inc. / WM Japan ...）
 *   5. アーティスト名の漢字（中国語圏の名義もあり得るので、ジャンル・レーベルより後に見る）
 * どれにも当たらなければ洋楽。外れていたら画面で切り替える。
 */

export type Waboku = "洋楽" | "邦楽";

export interface WabokuInput {
  /** クレジット順。判定には主にメインの名義（先頭）を使う */
  artistNames: string[];
  title: string;
  /** メインの名義のジャンル（Spotify の artist.genres） */
  genres: string[];
  label: string;
  /** Release Master で同じアーティストに付いていた洋邦（最新の行） */
  history: Waboku | null;
}

export interface WabokuResult {
  waboku: Waboku;
  /** 画面に出す判定の根拠 */
  reason: string;
}

const KANA = /[぀-ゟ゠-ヿ]/;
const KANJI = /[一-鿿]/;

/** 日本の音楽を指すジャンル名 */
const JAPANESE_GENRE = /(^|\s)j-|japanese|\banime\b|vocaloid|visual kei|kayokyoku|enka|shibuya-kei|\bjpop\b|\bjrock\b/i;

/**
 * 日本のレーベル名。Spotify の label 欄に出る表記で拾う。
 * 海外作品の日本盤は原盤のレーベル名で載るので、ここに当たるのはほぼ国内作品
 */
const JAPANESE_LABEL = new RegExp([
  "\\bjapan\\b",
  "sony music (labels|records|associated records|direct|solutions)",
  "universal music llc",
  "universal sigma",
  "avex",
  "victor entertainment",
  "jvckenwood",
  "pony canyon",
  "toy'?s factory",
  "king records",
  "lantis",
  "aniplex",
  "nippon columbia",
  "teichiku",
  "tokuma",
  "a-sketch",
  "bandai namco",
  "for life music",
  "nippon crown",
  "ki/oon",
  "sme records",
  "unborde",
  "space shower",
  "p-vine",
  "ultra-vybe",
  "tunecore japan",
  "rhythm zone",
  "zetima",
  "being,? inc",
].join("|"), "i");

export function classifyWaboku(input: WabokuInput): WabokuResult {
  if (input.history) return { waboku: input.history, reason: "過去の登録" };

  const main = input.artistNames[0] ?? "";
  // かなは日本語でしか使わないので、共演の名義（"CHAMELEON LIME WHOOPIEPIE, ネコニスズ"）まで見る
  if (input.artistNames.some((n) => KANA.test(n)) || KANA.test(input.title)) return { waboku: "邦楽", reason: "日本語の表記" };

  const genre = input.genres.find((g) => JAPANESE_GENRE.test(g));
  if (genre) return { waboku: "邦楽", reason: `ジャンル：${genre}` };

  if (input.label && JAPANESE_LABEL.test(input.label)) return { waboku: "邦楽", reason: `レーベル：${input.label}` };

  if (KANJI.test(main)) return { waboku: "邦楽", reason: "日本語の表記" };

  return { waboku: "洋楽", reason: input.genres.length > 0 ? `ジャンル：${input.genres[0]}` : "日本の手がかりなし" };
}

/**
 * 洋邦によって変わる「シートに書く作品名」と「対象外の理由」。
 * 洋楽はオリジナルアルバムだけ、邦楽はEPも取り込む（Weeklyの運用）。
 * 画面で洋邦を切り替えたときも同じ規則で作り直す。
 *
 * @param baseExcludeReason 洋邦に関係なく対象外になる理由（シングル・リイシュー・デラックス版など）
 */
export function titleAndExclusion(
  albumName: string,
  type: string,
  baseExcludeReason: string | null,
  waboku: Waboku,
): { title: string; excludeReason: string | null } {
  if (type !== "EP") return { title: albumName, excludeReason: baseExcludeReason };
  return waboku === "邦楽"
    ? { title: `[EP] ${albumName}`, excludeReason: baseExcludeReason }
    : { title: albumName, excludeReason: baseExcludeReason ?? "洋楽のEP" };
}
