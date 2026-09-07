/**
 * アプリ共通のボトムナビ・フッター・本文下余白を外す画面。
 *
 * 投稿画像ジェネレーターの編集画面だけが対象。編集は縦の余白がそのまま
 * プレビューの大きさに効くため、共通ナビとフッターの分（実測で 75px と 241px、
 * さらに main の下余白 144px）を返す。一覧・履歴・アプリ本体の画面は従来どおり。
 */
export function isImmersiveRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // /generator/<id> のみ。/generator（一覧）と /generator/<id>/history は通常の枠を使う。
  return /^\/generator\/[^/]+$/.test(pathname);
}
