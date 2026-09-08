import type { GeneratorDocument, ItemContent } from "./model";

export type CanvasPreviewSlot = Pick<ItemContent, "fields" | "show" | "tracking" | "kerns" | "bodyLeadMode" | "bodyMaxLead" | "typography"> & {
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
};

function isoWeek(value: string): { year: number; number: number } {
  const source = new Date(`${value}T00:00:00.000Z`);
  const thursday = new Date(source), day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  return { year, number: Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}

export function canvasPreviewPage(document: GeneratorDocument, pageIndex: number): CanvasPreviewPage | null {
  const page = document.pages[pageIndex];
  if (!page) return null;
  const items = new Map(document.items.map(item => [item.id, item]));
  // Weekly表紙の5枚はfeatureページの順序から導出する。表紙にitemIdを
  // 重複保存しないことで、swap後も必ず同じ選定が表紙へ反映される。
  const sourceIds = page.kind === "cover"
    ? document.pages.filter(value => value.kind === "feature").flatMap(value => value.itemIds)
    : page.itemIds;
  const slots = sourceIds.flatMap(id => {
    const item = items.get(id);
    if (!item) return [];
    const { fields, show, tracking, kerns, bodyLeadMode, bodyMaxLead, typography } = item.content;
    return [{ id: item.id, sourceUid: item.source.uid, sourceNo: item.source.no, sourceCoverUrl: item.source.coverUrl || null, jacketAssetId: item.content.jacketAssetId,
      fields, show, tracking, kerns, bodyLeadMode, bodyMaxLead, typography }];
  });
  if (slots.length !== sourceIds.length) return null;
  const computedWeek = document.series === "weekly" ? isoWeek(document.period.start) : null;
  return {
    id: page.id,
    kind: page.kind,
    no: document.series === "weekly" ? pageIndex : pageIndex + 2,
    bgColor: page.bgColor,
    slots,
    week: computedWeek
      ? { year: computedWeek.year, number: document.period.weekNumber ?? computedWeek.number }
      : null,
  };
}
