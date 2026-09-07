"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";
import { bodyIndexAt, hitTest, selectionRects, type FieldKey, type Rect } from "./hit-test";
import { drawPageInto, preparePage, useGeneratorRuntime, type GeneratorRuntime, type LegacyPage } from "./runtime";
import { Chip, PrimaryButton, SecondaryButton } from "./ui";

export type PreviewSelection = { slotIndex: number; key: FieldKey; start: number; end: number };

/** 本文の行送りが自動でどこまで詰まっているか。描画と同じ関数で読み取るだけ。 */
export type BodyDiagnostic = { slotId: string; lines: number; lead: number; minLead: number; fits: boolean };
export type PreviewDiagnostics = { pageId: string; warnings: string[]; body: BodyDiagnostic[] };

function pageLabel(page: CanvasPreviewPage): string {
  return page.kind === "adopted" ? "採用 · 1作品" : `掲載 · ${page.slots.length}作品`;
}

export default function GeneratorPreview({
  document: value,
  page,
  pageNumber,
  onDiagnostics,
  onSelect,
  selection,
  canExport,
  blockedReasons,
}: {
  document: GeneratorDocument;
  page: CanvasPreviewPage;
  pageNumber: number;
  onDiagnostics(result: PreviewDiagnostics): void;
  onSelect(value: PreviewSelection & { touch?: boolean }): void;
  selection: PreviewSelection | null;
  canExport: boolean;
  blockedReasons: string[];
}) {
  const { runtime, error, stalled, retry } = useGeneratorRuntime();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preparedRef = useRef<LegacyPage | null>(null);
  const [status, setStatus] = useState("描画を準備しています…"), [warnings, setWarnings] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [rects, setRects] = useState<Rect[]>([]);
  const dragRef = useRef<{ anchor: number; slotIndex: number } | null>(null);
  const signature = JSON.stringify(page);
  const selectionKey = selection ? `${selection.slotIndex}:${selection.key}:${selection.start}:${selection.end}` : "";

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void (async () => {
      const prepared = await preparePage(runtime, value.id, page);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = drawPageInto(runtime, canvas, prepared, 1200);
      if (!context) { setStatus("描画領域を準備できませんでした。"); return; }
      preparedRef.current = prepared;
      const issues = runtime.renderer.inspectPage(context, prepared);
      setWarnings(issues);
      onDiagnostics({ pageId: prepared.id, warnings: issues, body: bodyDiagnostics(runtime, context, prepared) });
      const missing = prepared.slots.filter(slot => !slot.jacket.img).length;
      setStatus(`${pageLabel(page)}${missing ? `（ジャケット未取得 ${missing}件）` : ""}`);
    })().catch(drawError => { if (!cancelled) setStatus(`描画できませんでした: ${(drawError as Error).message}`); });
    return () => { cancelled = true; };
    // signature はページ内容のハッシュ代わり。中身が変わったときだけ描き直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDiagnostics, runtime, signature, value.id]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    const slot = selection && page.kind === "adopted" ? page.slots[selection.slotIndex] : null;
    if (!runtime || !context || !slot || !selection || selection.key !== "text" || selection.end <= selection.start) {
      setRects(current => (current.length === 0 ? current : []));
      return;
    }
    setRects(selectionRects(runtime, context, slot, selection.start, selection.end));
    // signature はページ内容のハッシュ代わり。内容か選択が変わったときだけ測り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, signature, selectionKey]);

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * 1200, y: (event.clientY - box.top) / box.height * 1200 };
  }

  function pick(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext("2d");
    if (!runtime || !context) return null;
    const { x, y } = canvasPoint(event);
    const hit = hitTest(runtime, context, page, x, y);
    if (!hit) return null;
    const caret = hit.index ?? 0;
    onSelect({ slotIndex: hit.slotIndex, key: hit.key, start: caret, end: caret, touch: event.pointerType === "touch" });
    return hit;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    // タッチはタップだけを扱う。canvas上でドラッグを奪うとページのスクロールが止まるため。
    if (event.pointerType === "touch") return;
    const hit = pick(event);
    if (!hit || hit.key !== "text" || hit.index === null) return;
    dragRef.current = { anchor: hit.index, slotIndex: hit.slotIndex };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is optional; the drag still tracks */ }
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const context = canvasRef.current?.getContext("2d");
    const slot = drag ? page.slots[drag.slotIndex] : null;
    if (!drag || !runtime || !context || !slot) return;
    const { x, y } = canvasPoint(event);
    const index = bodyIndexAt(runtime, context, slot, x, y);
    onSelect({ slotIndex: drag.slotIndex, key: "text", start: Math.min(drag.anchor, index), end: Math.max(drag.anchor, index) });
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      dragRef.current = null;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
      return;
    }
    if (event.pointerType === "touch") pick(event);
  }

  async function exportPng(share: boolean) {
    const prepared = preparedRef.current;
    if (!runtime || !prepared || exporting) return;
    setExporting(true);
    try {
      const { canvas } = await runtime.exporter.renderTiled(prepared, runtime.images, {
        size: value.theme.outputSize,
        onProgress: (current, total) => setStatus(`PNGを生成しています… ${current}/${total}`),
      });
      try {
        const blob = await runtime.exporter.canvasBlob(canvas);
        const series = value.series === "japan" ? "monthly-japan" : "monthly";
        const [year, month] = value.period.start.slice(0, 7).split("-");
        const name = `${series}_${year.slice(2)}_${month}_${String(prepared.no).padStart(2, "0")}.png`;
        const file = new File([blob], name, { type: "image/png" });
        const shared = Boolean(share && navigator.canShare?.({ files: [file] }));
        if (shared) await navigator.share({ files: [file], title: name });
        else {
          const url = URL.createObjectURL(blob), anchor = window.document.createElement("a");
          anchor.href = url;
          anchor.download = name;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        setStatus(`${name} を${shared ? "共有" : "保存"}しました。`);
      } finally { runtime.exporter.releaseCanvas(canvas); }
    } catch (exportError) {
      setStatus(`PNGを書き出せませんでした: ${(exportError as Error).message}`);
    } finally { setExporting(false); }
  }

  const blocked = !canExport || warnings.length > 0;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">画像 {pageNumber}</h2>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{pageLabel(page)}</span>
      </div>
      <div
        className="relative mx-auto w-full max-w-[min(100%,40rem,max(14rem,45dvh))] overflow-hidden rounded-xl border bg-black xl:max-w-[min(100%,40rem,max(14rem,calc(100vh-31rem)))]"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <canvas
          ref={canvasRef}
          width={1200}
          height={1200}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="block aspect-square h-auto w-full cursor-text select-none"
          aria-label={`画像${pageNumber} ${pageLabel(page)}`}
        />
        {/* 選択表示は操作用。DOMに重ねるだけなのでPNGにも保存データにも入らない。 */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {rects.map((rect, index) => (
            <span
              key={index}
              className="absolute rounded-[2px]"
              style={{
                left: `${rect.x / 12}%`,
                top: `${rect.y / 12}%`,
                width: `${rect.w / 12}%`,
                height: `${rect.h / 12}%`,
                backgroundColor: "rgba(96,165,250,.38)",
              }}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
        プレビューをクリックすると調整対象が切り替わります。評価文はドラッグで範囲を選べます。
      </p>

      <p role="status" className="text-xs" style={{ color: "var(--text-secondary)" }}>{status}</p>

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton disabled={exporting || !runtime || blocked} onClick={() => void exportPng(false)}>PNGを保存</PrimaryButton>
        <SecondaryButton disabled={exporting || !runtime || blocked} onClick={() => void exportPng(true)}>共有</SecondaryButton>
        <Chip tone="info">{value.theme.outputSize} × {value.theme.outputSize}</Chip>
      </div>

      {(stalled || error) && !runtime && (
        <div
          className="rounded-xl border px-4 py-3 text-xs"
          style={{ borderColor: "rgba(244,63,94,.35)", backgroundColor: "rgba(244,63,94,.08)", color: "#fda4af" }}
        >
          <p className="font-semibold">描画の準備が終わりません</p>
          <p className="mt-1 leading-5">
            {error || "書体・描画モジュール・Release Masterのいずれかを取得できていません。"}
            通信を確認してからやり直してください。準備が終わるまでPNGは書き出せません。
          </p>
          <div className="mt-2">
            <SecondaryButton onClick={retry} className="min-h-9 px-3 text-xs">描画の準備をやり直す</SecondaryButton>
          </div>
        </div>
      )}

      {blocked && (
        <details
          className="rounded-xl border px-4 py-2 text-xs"
          style={{ borderColor: "rgba(245,158,11,.35)", backgroundColor: "rgba(245,158,11,.08)", color: "#fcd34d" }}
        >
          <summary className="cursor-pointer py-1 font-semibold">
            PNGを書き出せない理由（{(canExport ? 0 : 1) + warnings.length}件）
          </summary>
          <ul className="mt-2 space-y-1 pb-1">
            {!canExport && (
              <li>
                共有DBに未保存の変更があります。{blockedReasons.length > 0 && `未保存: ${blockedReasons.join(" / ")}。`}
                保存すると、その版の内容でPNGを作成できます。
              </li>
            )}
            {warnings.map(warning => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      )}

      {!page.bgColor && <p className="text-xs text-amber-300">背景色は未設定のため、プレビューだけに仮の色を使っています。</p>}
    </div>
  );
}

function bodyDiagnostics(runtime: GeneratorRuntime, context: CanvasRenderingContext2D, page: LegacyPage): BodyDiagnostic[] {
  if (page.kind !== "adopted") return [];
  return page.slots.map(slot => {
    const data = runtime.pages.toDrawData(slot);
    const lines = runtime.renderer.bodyLineCount(context, data.body || "", data.tracking, data.kerns);
    const { lead } = runtime.layout.bodyLayoutFor(lines, data.bodyLeadMode === "custom" ? data.bodyMaxLead : undefined);
    return { slotId: slot.id, lines, lead, minLead: runtime.layout.TYPE.body.size, fits: runtime.layout.bodyFits(lines) };
  });
}
