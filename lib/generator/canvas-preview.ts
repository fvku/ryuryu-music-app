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
  kind: "adopted" | "listed";
  no: number;
  bgColor: string | null;
  slots: CanvasPreviewSlot[];
};

export function canvasPreviewPage(document: GeneratorDocument, pageIndex: number): CanvasPreviewPage | null {
  const page = document.pages[pageIndex];
  if (!page) return null;
  const items = new Map(document.items.map(item => [item.id, item]));
  const slots = page.itemIds.flatMap(id => {
    const item = items.get(id);
    if (!item) return [];
    const { fields, show, tracking, kerns, bodyLeadMode, bodyMaxLead, typography } = item.content;
    return [{ id: item.id, sourceUid: item.source.uid, sourceNo: item.source.no, sourceCoverUrl: item.source.coverUrl || null, jacketAssetId: item.content.jacketAssetId,
      fields, show, tracking, kerns, bodyLeadMode, bodyMaxLead, typography }];
  });
  if (slots.length !== page.itemIds.length) return null;
  return { id: page.id, kind: page.kind, no: pageIndex + 2, bgColor: page.bgColor, slots };
}
