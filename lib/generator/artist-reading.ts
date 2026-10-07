import path from "node:path";
import type { ReleaseMasterAlbum } from "../types";

/**
 * 同じ日付の作品をアーティスト名で並べるときの読み（2026-10-07、Koheiの決定）。
 *
 * 規則：アルファベットはa-z、日本語はあいうえお順。英字の名前が先、日本語の名前が後
 * （`Intl.Collator("ja")`の既定。かなの名前は文字そのものが読みになる）。
 *
 * 漢字の名前は文字から読みが決まらない（文字コード順や辞書順では「細野→松田→斉藤→石川」のように並ぶ）。
 * そこで読みを次の順で決める。
 *   1. Release Masterの「読み」列（任意の列。あればその値をそのまま使う。推定の読み違いはここで直す）
 *   2. 形態素解析（kuromoji）の推定。人名は概ね正しいが、有元→ゆうもと、幽体→かそけたい のような読み違いがある
 *   3. どちらも無ければ名前そのもの（辞書を読み込めなかったときも、並び替え自体は止めない）
 *
 * 辞書の読み込みは非同期（初回だけ約2秒）なので、Release Masterを読む`readGeneratorReleaseMaster`が
 * 先に`prepareArtistReading()`を待つ。並べ替え（`sortAlbums`）は同期のまま、読み込み済みの辞書を使う。
 */

type Token = { surface_form: string; reading?: string };
type Tokenizer = { tokenize(text: string): Token[] };

let tokenizer: Tokenizer | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, string>();

/** 漢字・かなを含む名前か。英字だけの名前は読みを推定しない。 */
const JAPANESE = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/;

/** カタカナをひらがなへ（照合をかなの種類で揺らさないため）。 */
function hiragana(value: string): string {
  return value.replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/** 辞書を読み込む。失敗しても例外は投げない（読みは名前そのものへ落ちる）。 */
export function prepareArtistReading(): Promise<void> {
  if (tokenizer) return Promise.resolve();
  return loading ||= (async () => {
    try {
      const { default: kuromoji } = await import("kuromoji");
      const dicPath = path.join(process.cwd(), "node_modules", "kuromoji", "dict");
      tokenizer = await new Promise<Tokenizer>((resolve, reject) => {
        kuromoji.builder({ dicPath }).build((error, built) => error ? reject(error) : resolve(built as Tokenizer));
      });
    } catch (error) {
      console.warn("[generator] アーティスト名の読みの辞書を読み込めませんでした。名前のまま並べます。", error);
    } finally {
      loading = null;
    }
  })();
}

/** 推定した読み（ひらがな）。日本語を含まない名前・辞書が無いときは名前そのもの。 */
export function guessArtistReading(name: string): string {
  const value = name.trim();
  if (!tokenizer || !JAPANESE.test(value)) return value;
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  const reading = hiragana(tokenizer.tokenize(value).map(token => token.reading && token.reading !== "*" ? token.reading : token.surface_form).join(""));
  cache.set(value, reading);
  return reading;
}

/** 並べ替えに使う読み。Release Masterの「読み」列が最優先。 */
export function artistOrderKey(album: Pick<ReleaseMasterAlbum, "artist" | "artistReading">): string {
  return hiragana(album.artistReading?.trim() || guessArtistReading(album.artist));
}

const collator = new Intl.Collator("ja");
/** アーティスト名の並び。英字はa-z、日本語はあいうえお順（英字が先）。 */
export function compareArtistReading(a: Pick<ReleaseMasterAlbum, "artist" | "artistReading">, b: Pick<ReleaseMasterAlbum, "artist" | "artistReading">): number {
  return collator.compare(artistOrderKey(a), artistOrderKey(b)) || collator.compare(a.artist.trim(), b.artist.trim());
}
