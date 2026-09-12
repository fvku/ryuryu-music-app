import type { GeneratorDocument, GeneratorItem, GeneratorItemSource } from "@/lib/generator/model";
import type { ReleaseMasterAlbum } from "@/lib/types";

/**
 * Release Masterの行から、作品の「取り込み基準」を組み直す。
 *
 * 保存APIは作品の `content` と一緒に `source` も受け取れる（v2 §8-1、Codex実装）。
 * 文字情報を読み直したときに基準も進めておかないと、次の更新で同じ差分が
 * 「手で修正済み」として出続ける。カバー画像の差し替えもここでしか追従できない。
 *
 * `content` は作らない。利用者が直した文字を上書きしないため。
 */
export function releaseMasterSource(album: ReleaseMasterAlbum, importedAt: string): GeneratorItemSource {
  return {
    kind: "release-master",
    uid: album.uid.trim() || null,
    no: album.no || null,
    date: album.date,
    importedAt,
    coverUrl: album.coverUrlLarge.trim() || album.coverUrl.trim() || null,
    fields: {
      title: album.title,
      artist: album.artist,
      duration: album.duration,
      genreMemo: album.genreMemo,
      country: album.country,
      trackNo: album.mjTrackNo,
      track: album.mjTrack,
      text: album.mjText,
    },
  };
}

/** `importedAt` は毎回変わるので、中身が変わったかどうかだけを見る。 */
export function sourceChanged(previous: GeneratorItemSource, next: GeneratorItemSource): boolean {
  const strip = (value: GeneratorItemSource) => JSON.stringify({ ...value, importedAt: null });
  return strip(previous) !== strip(next);
}

/**
 * 実際に基準を進める作品を選ぶ。
 * 手で直した作品まで黙って進めると、次の更新で差分が出なくなってしまうので、
 * **利用者がその作品の項目を選んだとき**か、**カバー画像が変わったとき**だけにする。
 * カバーは画像に出るので、未保存として見せてよい。
 */
export function pendingSourceUpdates({
  items,
  sources,
  selectedItemIds,
}: {
  items: Pick<GeneratorItem, "id" | "source">[];
  sources: Record<string, GeneratorItemSource>;
  selectedItemIds: ReadonlySet<string>;
}): Record<string, GeneratorItemSource> {
  const result: Record<string, GeneratorItemSource> = {};
  for (const item of items) {
    if (item.source.kind !== "release-master") continue;
    const next = sources[item.id];
    if (!next || !sourceChanged(item.source, next)) continue;
    if (!selectedItemIds.has(item.id) && next.coverUrl === item.source.coverUrl) continue;
    result[item.id] = next;
  }
  return result;
}

/** 差分ダイアログを開いた時点の、作品ID → 最新の取り込み基準。 */
export function collectSources({
  document,
  albums,
  matchAlbum,
  importedAt,
}: {
  document: GeneratorDocument;
  albums: ReleaseMasterAlbum[];
  matchAlbum(item: GeneratorItem): ReleaseMasterAlbum | null;
  importedAt: string;
}): Record<string, GeneratorItemSource> {
  void albums;
  const result: Record<string, GeneratorItemSource> = {};
  for (const item of document.items) {
    if (item.source.kind !== "release-master") continue;
    const album = matchAlbum(item);
    if (album) result[item.id] = releaseMasterSource(album, importedAt);
  }
  return result;
}
