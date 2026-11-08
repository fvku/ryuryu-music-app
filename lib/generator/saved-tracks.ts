/**
 * Saved Tracks Stories画像（/generator/saved-tracks）の、描画にもサーバーにも依存しない部分。
 * プレイリストの読み取り結果の整形、版面の数値、文字の収め方をここに集める。
 */

/** Hyoryu's Saved Tracks。毎週月曜に曲がまとめて追加される。 */
export const SAVED_TRACKS_PLAYLIST_ID = "6stewW41e2gvYLcg5sRYSK";

export type SavedTrack = {
  id: string;
  title: string;
  artist: string;
  /** 一覧の手前に出す小さい画像 */
  thumbUrl: string;
  /** Spotify APIが返す最大の画像（640px） */
  coverUrl: string;
  addedAt: string;
};

export type SavedTrackGroup = { date: string; tracks: SavedTrack[] };

type RawImage = { url?: unknown };
type RawTrack = {
  id?: unknown;
  name?: unknown;
  is_local?: unknown;
  type?: unknown;
  artists?: { name?: unknown }[];
  album?: { images?: RawImage[] };
};
type RawItem = { added_at?: unknown; track?: RawTrack | null };

/** ローカルファイルやポッドキャストなど、ジャケットを持つ楽曲でない行は捨てる。 */
export function parsePlaylistItems(items: unknown[]): SavedTrack[] {
  const tracks: SavedTrack[] = [];
  for (const item of items as RawItem[]) {
    const track = item?.track;
    if (!track || track.is_local === true || (track.type !== undefined && track.type !== "track")) continue;
    if (typeof track.id !== "string" || typeof track.name !== "string" || typeof item.added_at !== "string") continue;
    const images = (track.album?.images ?? []).map(image => image?.url).filter((url): url is string => typeof url === "string");
    if (images.length === 0) continue;
    tracks.push({
      id: track.id,
      title: track.name,
      artist: (track.artists ?? []).map(artist => artist?.name).filter((name): name is string => typeof name === "string").join(", "),
      coverUrl: images[0],
      thumbUrl: images[images.length - 1],
      addedAt: item.added_at,
    });
  }
  return tracks;
}

/**
 * 曲名から `(feat. …)` を外す。共演者はアーティスト欄に載るので二重になる。
 * `(with …)` は "Dance (With Somebody)" のような曲名と区別できないので残す。
 */
export function cleanTrackTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
    .trim();
  return cleaned || title;
}

/** 追加日は日本時間で数える。月曜の追加分が日付の境目で割れないように。 */
export function addedDateInTokyo(addedAt: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(addedAt));
}

/** 新しい追加日から順に並べる。同じ日の中はプレイリストの並びのまま。 */
export function groupByAddedDate(tracks: SavedTrack[]): SavedTrackGroup[] {
  const groups = new Map<string, SavedTrack[]>();
  for (const track of tracks) {
    const date = addedDateInTokyo(track.addedAt);
    const group = groups.get(date);
    if (group) group.push(track);
    else groups.set(date, [track]);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => ({ date, tracks: items }));
}

/** 開いたときにチェックを入れておく曲。最新の追加分の先頭から。 */
export function initialSelection(tracks: SavedTrack[], count = 3): string[] {
  return (groupByAddedDate(tracks)[0]?.tracks ?? []).slice(0, count).map(track => track.id);
}

/**
 * ジャケットの取得先を、大きい順に返す。
 * APIは640pxまでしか返さないが、同じ画像IDの種別を変えると1000pxが取れる（非公開の仕様なので、失敗したら640pxへ戻す）。
 */
export function jacketUrlCandidates(coverUrl: string): string[] {
  const larger = coverUrl.replace("ab67616d0000b273", "ab67616d000082c1");
  return larger === coverUrl ? [coverUrl] : [larger, coverUrl];
}

/** 書き出すファイルの名前。例: saved_tracks_26_11_02_01.png */
export function storyFileName(date: string, no: number): string {
  return `${storyArchiveBase(date)}_${String(no).padStart(2, "0")}.png`;
}

export function storyArchiveName(date: string): string {
  return `${storyArchiveBase(date)}.zip`;
}

function storyArchiveBase(date: string): string {
  const [year, month, day] = date.split("-");
  return `saved_tracks_${year.slice(2)}_${month}_${day}`;
}

/** Figma「Saved_1〜3」の実測値（1080×1920基準）。 */
export const STORY = {
  width: 1080,
  height: 1920,
  title: { x: 190, y: 190, width: 700, height: 316.0234375 },
  dots: [
    { x: 706.4, y: 458.03, diameter: 36.842 },
    { x: 779.05, y: 448.27, diameter: 32.749 },
    { x: 846.8, y: 415.55, diameter: 28.655 },
    { x: 874.96, y: 360.07, diameter: 24.561 },
    { x: 851.34, y: 302.04, diameter: 20.468 },
    { x: 797.81, y: 275.11, diameter: 16.374 },
  ],
  card: { x: 90, y: 570, width: 900, height: 1072, radius: 80 },
  jacket: { x: 165, y: 648.84, size: 750, radius: 80 },
  pill: { x: 165, y: 1415.84, width: 750, height: 160, radius: 80 },
  text: {
    // 帯の中央（540）ではない。Figmaの文字枠は左寄せの744px幅の中にあり、中心が3px左になる。
    centerX: 537,
    maxWidth: 670,
    title: { baseline: 1487.84, size: 54, minSize: 30, weight: 400, tracking: -0.05 },
    artist: { baseline: 1547.84, size: 42, minSize: 26, weight: 200, tracking: 0 },
  },
  logo: { x: 415, y: 1642, width: 250, height: 141 },
} as const;

/**
 * 動画を選ぶ前に使う、Figmaの3枚と同じ背景。
 * pan はFigmaの配置（left -600 / -626 / -750、幅2580.5）を、はみ出し量に対する割合へ直したもの。
 */
export const STILL_BACKGROUNDS = [
  { key: "a", pan: 600 / 1500.5 },
  { key: "b", pan: 626 / 1501 },
  { key: "a", pan: 750 / 1500.5 },
] as const;

export type SourceRect = { x: number; y: number; width: number; height: number };

/** 元画像から描画先いっぱいに切り出す範囲。はみ出す方向だけ pan（0〜1）で動かす。 */
export function coverCrop(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, pan = 0.5): SourceRect {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = targetWidth / scale, height = targetHeight / scale;
  const position = Math.min(1, Math.max(0, pan));
  return { x: (sourceWidth - width) * position, y: (sourceHeight - height) * position, width, height };
}

export type FittedText = { text: string; size: number; truncated: boolean };

/** 幅に収まるまで文字を縮める。下限でも収まらなければ末尾を「…」にする。measure は文字サイズに比例する幅を返す。 */
export function fitText(
  text: string,
  { size, minSize, maxWidth }: { size: number; minSize: number; maxWidth: number },
  measure: (value: string, size: number) => number,
): FittedText {
  const width = measure(text, size);
  if (width <= maxWidth) return { text, size, truncated: false };
  const fitted = Math.max(minSize, Math.floor((size * maxWidth / width) * 2) / 2);
  if (measure(text, fitted) <= maxWidth) return { text, size: fitted, truncated: false };
  const characters = Array.from(text);
  while (characters.length > 1 && measure(`${characters.join("").trimEnd()}…`, fitted) > maxWidth) characters.pop();
  return { text: `${characters.join("").trimEnd()}…`, size: fitted, truncated: true };
}

/** 動画の中から、画像ごとに重なりにくい初期フレームを選ぶ。枚数を変えても既存の画像の位置は動かない。 */
export function defaultFrameTime(index: number, duration: number): number {
  return ((0.15 + index * 0.618) % 1) * duration;
}
