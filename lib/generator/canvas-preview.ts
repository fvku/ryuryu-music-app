import type { GeneratorDocument, ItemContent } from "./model";

export type CanvasPreviewSlot = Pick<ItemContent, "fields" | "show" | "tracking" | "kerns" | "bodyLeadMode" | "bodyMaxLead" | "typography" | "coverFocusX" | "coverFocusY"> & {
  id: string;
  sourceUid: string | null;
  sourceNo: string | null;
  sourceCoverUrl: string | null;
  jacketAssetId: string | null;
};

export type CanvasPreviewPage = {
  id: string;
  kind: GeneratorDocument["pages"][number]["kind"];
  no: number;
  bgColor: string | null;
  slots: CanvasPreviewSlot[];
  /** Weekly表紙の固定文言。年は対象金曜のISO週年、番号はRelease Masterの#列。 */
  week: { year: number; number: number } | null;
  /** 表紙の版面。Weeklyは縦帯5本、Japanは斜めの6枠（collage）、Monthlyは3×3の9枠（grid）。表紙以外はnull。 */
  coverLayout: CoverLayout | null;
};

export type CoverLayout = "weekly" | "collage" | "grid";

/**
 * Monthly／Japan表紙の枠の位置。文書の先頭からの作品順（Layout.COLLAGE／GRIDのSLOTSと同じ並び）。
 * 枠の数＝表紙に入る作品数。
 */
export const COVER_SLOT_LABELS = {
  collage: ["左上", "右上", "中央右", "右下", "中央左", "左下"],
  grid: ["左上", "上中央", "右上", "中央左", "中央", "中央右", "左下", "下中央", "右下"],
} as const satisfies Record<Exclude<CoverLayout, "weekly">, readonly string[]>;

/** 企画ごとの表紙の版面。Monthly（洋楽）は3×3、Japanは斜めの6枠（2026-10-08、Koheiの指定）。 */
export function coverLayoutOf(series: GeneratorDocument["series"]): CoverLayout {
  return series === "weekly" ? "weekly" : series === "monthly" ? "grid" : "collage";
}

function isoWeek(value: string): { year: number; number: number } {
  const source = new Date(`${value}T00:00:00.000Z`);
  const thursday = new Date(source), day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  return { year, number: Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}

/**
 * 画像番号。Weeklyは表紙が00。Monthly／Japanは表紙が01で、表紙を持たない旧文書は採用の先頭が02
 * （表紙は以前ジェネレーターの外で作っていたため、番号を空けてあった）。どちらでも採用の先頭は02になる。
 */
export function pageNumber(document: Pick<GeneratorDocument, "series" | "pages">, pageIndex: number): number {
  if (document.series === "weekly") return pageIndex;
  return document.pages[0]?.kind === "cover" ? pageIndex + 1 : pageIndex + 2;
}

/** 表紙に描く作品のID。表紙にitemIdを重複保存せず、後ろのページの並びから毎回導出する。 */
export function coverItemIds(document: Pick<GeneratorDocument, "series" | "pages">): string[] {
  // Weekly表紙の5枚はfeatureページの順序。Monthlyは採用→掲載の先頭9作品、Japanは先頭6作品。
  // どちらもswap・並び替えの後に、必ず同じ選定が表紙へ反映される。
  const layout = coverLayoutOf(document.series);
  if (layout === "weekly") return document.pages.filter(value => value.kind === "feature").flatMap(value => value.itemIds);
  return document.pages.filter(value => value.kind !== "cover").flatMap(value => value.itemIds).slice(0, COVER_SLOT_LABELS[layout].length);
}

export function canvasPreviewPage(document: GeneratorDocument, pageIndex: number): CanvasPreviewPage | null {
  const page = document.pages[pageIndex];
  if (!page) return null;
  const items = new Map(document.items.map(item => [item.id, item]));
  const sourceIds = page.kind === "cover" ? coverItemIds(document) : page.itemIds;
  const slots = sourceIds.flatMap(id => {
    const item = items.get(id);
    if (!item) return [];
    const { fields, show, tracking, kerns, bodyLeadMode, bodyMaxLead, typography } = item.content;
    return [{ id: item.id, sourceUid: item.source.uid, sourceNo: item.source.no, sourceCoverUrl: item.source.coverUrl || null, jacketAssetId: item.content.jacketAssetId,
      fields, show, tracking, kerns, bodyLeadMode, bodyMaxLead, typography,
      ...(item.content.coverFocusX === undefined ? {} : { coverFocusX: item.content.coverFocusX }),
      ...(item.content.coverFocusY === undefined ? {} : { coverFocusY: item.content.coverFocusY }) }];
  });
  if (slots.length !== sourceIds.length) return null;
  const computedWeek = document.series === "weekly" ? isoWeek(document.period.start) : null;
  return {
    id: page.id,
    kind: page.kind,
    no: pageNumber(document, pageIndex),
    bgColor: page.bgColor,
    slots,
    week: computedWeek
      ? { year: computedWeek.year, number: document.period.weekNumber ?? computedWeek.number }
      : null,
    coverLayout: page.kind !== "cover" ? null : coverLayoutOf(document.series),
  };
}
