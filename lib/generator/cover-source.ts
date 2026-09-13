import type { ReleaseMasterAlbum } from "../types";

/**
 * Release Masterの行からカバー画像のURLを決める。
 *
 * `画像リンク変換`（2000×2000）を先に見る。**Apple Music由来かどうかは問わない。**
 * その列に入っているhttpsのURLならそのまま使う。空のときだけ`spotifyカバー`へ落とす。
 *
 * 取り込み（`createGeneratorItem`）、取り込み基準の更新（`source-payload`）、
 * 取り込み済み作品にカバーが無いときの取得（`runtime`）で同じ順番を使う。
 */
export function releaseMasterCover(album: Pick<ReleaseMasterAlbum, "coverUrl" | "coverUrlLarge">): string | null {
  return album.coverUrlLarge.trim() || album.coverUrl.trim() || null;
}

/**
 * カバー画像として使えるURLか。文書に入る値の検査（`parseItemSource`）と同じ条件に合わせてある。
 * httpsだけを通し、長さは2000文字まで。取得元のホストは問わない。
 */
export function httpsImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** 外部カバーを、認証付き同一Originの画像取得APIへ向ける。 */
export function generatorRemoteImageUrl(value: string): string | null {
  const src = httpsImageUrl(value);
  return src ? `/api/generator/remote-image?url=${encodeURIComponent(src)}` : null;
}
