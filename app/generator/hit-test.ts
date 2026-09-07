import type { CanvasPreviewPage, CanvasPreviewSlot } from "@/lib/generator/canvas-preview";
import type { BandLayout, Cell, GeneratorRuntime } from "./runtime";

export type FieldKey = "title" | "artist" | "duration" | "genreMemo" | "country" | "trackNo" | "track" | "text";
export type Hit = { slotIndex: number; key: FieldKey; index: number | null };
export type Rect = { x: number; y: number; w: number; h: number };

/** 帯の実描画位置から、クリックに最も近い編集可能な項目を返す。 */
export function nearestBandField(layout: BandLayout, x: number, allowed: readonly FieldKey[]): FieldKey | null {
  let pen = layout.cell.x + (layout.cell.w - layout.total) / 2;
  let nearest: { key: FieldKey; distance: number } | null = null;
  for (const part of layout.parts) {
    if (part.key && allowed.includes(part.key as FieldKey)) {
      const distance = Math.abs(x - (pen + part.width / 2));
      if (!nearest || distance < nearest.distance) nearest = { key: part.key as FieldKey, distance };
    }
    pen += part.width + layout.gap;
  }
  return nearest?.key || null;
}

function bandFieldAt(
  runtime: GeneratorRuntime,
  context: CanvasRenderingContext2D,
  slot: CanvasPreviewSlot,
  cell: Cell,
  band: "meta" | "rec",
  x: number,
): FieldKey | null {
  const data = runtime.pages.toDrawData(slot);
  const layout = runtime.textLayout.bandLayout(context, data[band], runtime.layout.TYPE[band], cell, data.typography);
  return nearestBandField(layout, x, band === "meta" ? ["duration", "genreMemo", "country"] : ["trackNo", "track"]);
}

function inside(cell: Cell, x: number, y: number): boolean {
  return x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h;
}

/**
 * 本文の1行ぶんのレイアウト。均等割り付けの加算量は drawParagraph と同じ式で求める
 * （`extra = (枠幅 − 行幅) / 文字間の数`、段落の最終行は 0）。ここがずれると当たり判定が全部ずれる。
 */
function lineExtra(runtime: GeneratorRuntime, line: { clusters: unknown[]; width: number; paragraphEnd: boolean }): number {
  const gaps = line.clusters.length - 1;
  return !line.paragraphEnd && gaps > 0 ? (runtime.layout.TEXT.bodyW - line.width) / gaps : 0;
}

function bodyLayout(runtime: GeneratorRuntime, context: CanvasRenderingContext2D, slot: CanvasPreviewSlot) {
  const data = runtime.pages.toDrawData(slot);
  const lines = runtime.renderer.bodyLines(context, data.body || "", data.tracking, data.kerns);
  const { lead, baseline } = runtime.layout.bodyLayoutFor(lines.length, data.bodyLeadMode === "custom" ? data.bodyMaxLead : undefined);
  return { lines, lead, baseline };
}

/** 本文のクリック位置 → 原稿の文字位置。クラスタの中央より手前なら手前側に寄せる。 */
export function bodyIndexAt(runtime: GeneratorRuntime, context: CanvasRenderingContext2D, slot: CanvasPreviewSlot, x: number, y: number): number {
  const { lines, lead, baseline } = bodyLayout(runtime, context, slot);
  if (lines.length === 0) return 0;
  const row = lead > 0 ? Math.min(lines.length - 1, Math.max(0, Math.round((y - baseline) / lead))) : 0;
  const line = lines[row], extra = lineExtra(runtime, line);
  let pen = runtime.layout.TEXT.bodyX;
  for (const cluster of line.clusters) {
    const width = cluster.adv + extra;
    if (x < pen + width / 2) return cluster.at;
    pen += width;
  }
  return line.end;
}

/** 選択範囲を、プレビューに重ねる矩形（1200px基準）へ変換する。 */
export function selectionRects(
  runtime: GeneratorRuntime,
  context: CanvasRenderingContext2D,
  slot: CanvasPreviewSlot,
  start: number,
  end: number,
): Rect[] {
  if (end <= start) return [];
  const { lines, lead, baseline } = bodyLayout(runtime, context, slot);
  const { bodyAscent, bodyDescent, bodyX } = runtime.layout.TEXT;
  const rects: Rect[] = [];
  lines.forEach((line, row) => {
    const from = Math.max(start, line.start), to = Math.min(end, line.end);
    if (to <= from) return;
    const extra = lineExtra(runtime, line);
    let pen = bodyX, left: number | null = null, right = 0;
    for (const cluster of line.clusters) {
      const width = cluster.adv + extra;
      if (cluster.at + cluster.len > from && cluster.at < to) {
        if (left === null) left = pen;
        right = pen + width;
      }
      pen += width;
    }
    if (left === null) return;
    const y = baseline + row * lead - bodyAscent - 3;
    rects.push({ x: left, y, w: right - left, h: bodyAscent + bodyDescent + 6 });
  });
  return rects;
}

/**
 * プレビューのクリック位置 → 編集対象。
 * 帯は描画時と同じ bandLayout を使い、各文字列の実位置に最も近い項目を返す。
 */
export function hitTest(
  runtime: GeneratorRuntime,
  context: CanvasRenderingContext2D,
  page: CanvasPreviewPage,
  x: number,
  y: number,
): Hit | null {
  const slots = page.kind === "adopted"
    ? [{ slot: page.slots[0], cells: { ...runtime.layout.CELLS, body: runtime.layout.CELLS.body } }]
    : page.slots.map((slot, index) => ({ slot, cells: { ...runtime.layout.LISTED.cellsOf(index), body: null } }));

  for (const [slotIndex, entry] of slots.entries()) {
    if (!entry.slot) continue;
    const { cells } = entry;
    if (cells.body && inside(cells.body, x, y)) {
      return { slotIndex, key: "text", index: bodyIndexAt(runtime, context, entry.slot, x, y) };
    }
    if (inside(cells.title, x, y)) {
      const lines = runtime.renderer.titleLinesOf(context, entry.slot.fields.title, cells.title);
      const { title, artist } = runtime.layout.titleBaselines(cells.title, Math.max(1, lines.length));
      const lastTitle = title + runtime.layout.TEXT.titleLead * (Math.max(1, lines.length) - 1);
      return { slotIndex, key: y > (lastTitle + artist) / 2 ? "artist" : "title", index: null };
    }
    if (inside(cells.meta, x, y)) return { slotIndex, key: bandFieldAt(runtime, context, entry.slot, cells.meta, "meta", x) || "duration", index: null };
    if (inside(cells.rec, x, y)) return { slotIndex, key: bandFieldAt(runtime, context, entry.slot, cells.rec, "rec", x) || "track", index: null };
  }
  return null;
}
