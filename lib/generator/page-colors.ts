import type { GeneratorPage } from "./model";

/**
 * 背景色は作品に追従する（2026-11-08）。保存先はページのままなので、並びが変わったら色を作品のいたページから持ってくる。
 * 同じ区分の前のページだけを見る（採用と掲載では版面が違うので、区分をまたいだ作品は未設定から選び直す）。
 * 掲載は2作品で1色なので、上の作品の色を優先し、未設定なら下の作品の色を使う。
 * `202611080002_generator_structure_colors.sql` の並び順保存も同じ規則。変えるときは両方を揃える。
 */
export function bgColorFollowingItems(kind: GeneratorPage["kind"], itemIds: string[], previous: GeneratorPage[]): string | null {
  for (const itemId of itemIds) {
    const color = previous.find(page => page.kind === kind && page.itemIds.includes(itemId))?.bgColor;
    if (color) return color;
  }
  return null;
}

/** 表紙（作品なし）とOthers（1ページに全作品）は作品ごとの色を持たないので、ページの色のまま。 */
function followsItems(kind: GeneratorPage["kind"]): boolean {
  return kind === "adopted" || kind === "listed" || kind === "feature";
}

/** 並び順の編集中のプレビュー用。保存するとDBが同じ規則で色を移す。 */
export function pagesWithColorsFollowingItems(previous: GeneratorPage[], proposed: GeneratorPage[]): GeneratorPage[] {
  return proposed.map(page => followsItems(page.kind)
    ? { ...page, bgColor: bgColorFollowingItems(page.kind, page.itemIds, previous) }
    : page);
}
