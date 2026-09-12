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
