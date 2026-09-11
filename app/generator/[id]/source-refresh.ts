import { rebaseKerns } from "@/lib/generator/text-edit";
import type { GeneratorDocument, GeneratorItem, ItemContent } from "@/lib/generator/model";
import type { ReleaseMasterAlbum } from "@/lib/types";

/**
 * 取り込み後にRelease Master側で直された文字情報を、下書きへ読み直すための照合。
 *
 * 契約:
 * - 共有DBは触らない。結果はローカル下書きへ入れ、利用者が作品ごとの「保存」でversionにする。
 * - `item.source.fields` は取り込み時の原稿として残す。保存APIが受け取るのは `content` だけなので、
 *   ここでも `content.fields` しか書き換えない（差分の基準としてsourceを読むだけ）。
 * - 比べるのはその画像に実際に描かれる項目だけ。見えない項目まで書き換えると、
 *   気づけない未保存が増えてPNGの書き出しが止まる。
 */

export type RefreshFieldKey = keyof ItemContent["fields"];
export type RefreshPageKind = "adopted" | "listed" | "feature" | "others";

/** 画像に描かれる項目。ItemInspector の visibleFields と同じ並び・同じ範囲にする。 */
const PAGE_FIELDS: Record<RefreshPageKind, RefreshFieldKey[]> = {
  adopted: ["title", "artist", "duration", "genreMemo", "country", "trackNo", "track", "text"],
  // 掲載画像に評価文は描画されない。保存済みの値も書き換えない。
  listed: ["title", "artist", "duration", "genreMemo", "country", "trackNo", "track"],
  feature: ["title", "artist", "duration", "genreMemo", "country"],
  others: ["title", "artist"],
};

/** 表示チェックの持ち主。おすすめ曲は番号と曲名の両方を show.track が支配する。 */
const SHOW_OF: Record<RefreshFieldKey, keyof ItemContent["show"] | null> = {
  title: "title", artist: "artist", duration: "duration", genreMemo: "genreMemo",
  country: "country", trackNo: "track", track: "track", text: null,
};

export const FIELD_LABELS: Record<RefreshFieldKey, string> = {
  title: "作品名",
  artist: "アーティスト",
  duration: "曲数・総尺",
  genreMemo: "ジャンル",
  country: "国",
  trackNo: "おすすめ曲番号",
  track: "おすすめ曲名",
  text: "評価文",
};

/** 取り込みと同じ `[EP]` の前置き。lib/generator/source.ts の `ep` と同じ規則。 */
const EP_PREFIX = /^\s*[\[［]\s*ep\s*[\]］]\s*/i;

export type SourceRefreshChange = {
  key: RefreshFieldKey;
  /** いま下書き（未編集なら保存済み）に入っている値。 */
  current: string;
  /** Release Masterの最新値。 */
  next: string;
  /** 取り込み時の値から手で直してある項目。既定では取り込まない。 */
  edited: boolean;
};

export type SourceRefreshItem = {
  itemId: string;
  pageId: string;
  /** 画像番号。Weeklyは0始まり、Monthly／Japanは2始まり（canvasPreviewPageと同じ）。 */
  pageNo: number;
  kind: RefreshPageKind;
  /** 一覧の見出しに使う現在の作品名とアーティスト。 */
  title: string;
  artist: string;
  /** Release Masterに該当行が見つかったか。 */
  matched: boolean;
  changes: SourceRefreshChange[];
};

export function refreshableFields(kind: RefreshPageKind, show: ItemContent["show"]): RefreshFieldKey[] {
  return PAGE_FIELDS[kind].filter(key => {
    const showKey = SHOW_OF[key];
    return !showKey || show[showKey];
  });
}

function nameKey(title: string, artist: string): string {
  return `${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`;
}

/** UID → 作品名＋アーティスト → No.の順。同じ鍵が複数あればシート上で先に出る行を採る。 */
export function indexAlbums(albums: ReleaseMasterAlbum[]) {
  const byUid = new Map<string, ReleaseMasterAlbum>();
  const byNo = new Map<string, ReleaseMasterAlbum>();
  const byName = new Map<string, ReleaseMasterAlbum>();
  for (const album of albums) {
    const uid = album.uid.trim();
    if (uid && !byUid.has(uid)) byUid.set(uid, album);
    const no = album.no.trim();
    if (no && !byNo.has(no)) byNo.set(no, album);
    const key = nameKey(album.title, album.artist);
    if (!byName.has(key)) byName.set(key, album);
  }
  return { byUid, byNo, byName };
}

export function matchAlbum(item: GeneratorItem, index: ReturnType<typeof indexAlbums>): ReleaseMasterAlbum | null {
  return (item.source.uid ? index.byUid.get(item.source.uid.trim()) : undefined)
    || index.byName.get(nameKey(item.source.fields.title, item.source.fields.artist))
    || (item.source.no ? index.byNo.get(item.source.no.trim()) : undefined)
    || null;
}

/** Release Masterの1行を、取り込みと同じ規則で `content.fields` の値へ直す。 */
export function releaseMasterValue(album: ReleaseMasterAlbum, key: RefreshFieldKey, series: GeneratorDocument["series"]): string {
  switch (key) {
    case "title": return series === "weekly" ? album.title : album.title.replace(EP_PREFIX, "");
    case "artist": return album.artist;
    case "duration": return album.duration;
    case "genreMemo": return album.genreMemo;
    case "country": return album.country;
    case "trackNo": return album.mjTrackNo;
    case "track": return album.mjTrack;
    case "text": return series === "weekly" ? "" : album.mjText;
  }
}

/** 取り込み時に `content.fields` へ入った値。手で直したかどうかの基準にする。 */
function importedValue(item: GeneratorItem, key: RefreshFieldKey, series: GeneratorDocument["series"]): string {
  const value = item.source.fields[key];
  if (key === "title") return series === "weekly" ? value : value.replace(EP_PREFIX, "");
  if (key === "text") return series === "weekly" ? "" : value;
  return value;
}

/**
 * 文書の全作品について、Release Masterの最新値との差分を画像順に並べる。
 * 差分が無く、照合もできている作品は返さない。
 */
export function collectSourceRefresh({
  document,
  drafts,
  albums,
}: {
  document: GeneratorDocument;
  drafts: Record<string, ItemContent>;
  albums: ReleaseMasterAlbum[];
}): SourceRefreshItem[] {
  const index = indexAlbums(albums);
  const items = new Map(document.items.map(item => [item.id, item]));
  const results: SourceRefreshItem[] = [];
  document.pages.forEach((page, pageIndex) => {
    if (page.kind === "cover") return;
    const kind = page.kind as RefreshPageKind;
    for (const itemId of page.itemIds) {
      const item = items.get(itemId);
      if (!item) continue;
      // 手で足した作品はRelease Masterに元の行が無い。見つからない作品として並べても直しようがないので外す。
      if (item.source.kind !== "release-master") continue;
      const content = drafts[itemId] || item.content;
      const album = matchAlbum(item, index);
      const changes: SourceRefreshChange[] = [];
      if (album) {
        for (const key of refreshableFields(kind, content.show)) {
          const next = releaseMasterValue(album, key, document.series);
          const current = content.fields[key];
          if (next === current) continue;
          changes.push({ key, current, next, edited: current !== importedValue(item, key, document.series) });
        }
      }
      if (!album || changes.length) {
        results.push({
          itemId,
          pageId: page.id,
          pageNo: document.series === "weekly" ? pageIndex : pageIndex + 2,
          kind,
          title: content.fields.title,
          artist: content.fields.artist,
          matched: Boolean(album),
          changes,
        });
      }
    }
  });
  return results;
}

/**
 * 選んだ項目だけを下書きへ入れる。文字が変わると字間の文字別指定（kerns）の位置がずれるため、
 * ItemInspector の入力欄と同じ `rebaseKerns` を通す。
 */
export function applySourceRefresh(content: ItemContent, changes: { key: RefreshFieldKey; next: string }[]): ItemContent {
  let result = content;
  for (const { key, next } of changes) {
    const old = result.fields[key];
    if (old === next) continue;
    if (key === "text") {
      result = { ...result, fields: { ...result.fields, text: next }, kerns: rebaseKerns(old, next, result.kerns) };
      continue;
    }
    const style = result.typography[key];
    result = {
      ...result,
      fields: { ...result.fields, [key]: next },
      typography: style ? { ...result.typography, [key]: { ...style, kerns: rebaseKerns(old, next, style.kerns) } } : result.typography,
    };
  }
  return result;
}
