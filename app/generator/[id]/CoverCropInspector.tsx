"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import { preparePage, useGeneratorRuntime, type GeneratorRuntime } from "../runtime";
import { SecondaryButton } from "../ui";

/** 切り抜き位置の変更。`undefined`の軸は変えない。`null`は自動（Weekly）／中央（コラージュ）へ戻す。 */
export type CoverFocusChange = { x?: number | null; y?: number | null };

/**
 * 原版のどこが表紙に見えるか。軸ごとに「見えている幅の半分（原版比）」と、いまの中心を返す。
 * Weeklyは縦帯なので横だけ動く。コラージュは枠の外接矩形をcover-fitで覆うので、縦横どちらかだけが動く
 * （正方形のジャケットなら、横長の枠は縦に、縦長の枠は横に余る）。
 */
function cropWindow(runtime: GeneratorRuntime, page: CanvasPreviewPage, slotIndex: number, img: { width: number; height: number }, focusX: number, focusY: number) {
  const box = page.coverLayout === "collage" ? runtime.layout.COLLAGE.boxOf(slotIndex) : runtime.layout.WEEKLY.COVER.bandCell(0);
  const scale = Math.max(box.w / img.width, box.h / img.height);
  const halfW = box.w / (img.width * scale) / 2, halfH = box.h / (img.height * scale) / 2;
  const clamp = (value: number, half: number) => Math.min(1 - half, Math.max(half, value));
  return { box, scale, halfW, halfH, cx: clamp(focusX, halfW), cy: page.coverLayout === "collage" ? clamp(focusY, halfH) : .5 };
}

/** 表紙だけに効く位置調整。いまの切り抜き位置からスライダーを動かし始める。 */
export default function CoverCropInspector({ documentId, page, slotIndex, disabled, onFocus }: {
  documentId: string;
  page: CanvasPreviewPage;
  slotIndex: number;
  disabled: boolean;
  onFocus(value: CoverFocusChange): void;
}) {
  const { runtime } = useGeneratorRuntime();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [prepared, setPrepared] = useState<{ geometry: string; focusX: number; halfW: number; halfH: number } | null>(null);
  const slot = page.slots[slotIndex];
  const collage = page.coverLayout === "collage";
  const signature = JSON.stringify(slot);
  // 見える幅（スライダーの範囲）はジャケットと枠だけで決まる。位置を動かして描き直している間も
  // スライダーを無効にしない（無効にするとフォーカスが外れ、キーボードやドラッグが1段で止まる）。
  const geometry = JSON.stringify([slot?.id, slot?.jacketAssetId, slot?.sourceCoverUrl, slotIndex, page.coverLayout]);

  useEffect(() => {
    if (!runtime || !slot) return;
    let cancelled = false;
    // コラージュは枠ごとに形が違うので、ページ全体を渡して同じ枠番号で準備する。
    const target = collage ? page : { ...page, slots: [slot] };
    void preparePage(runtime, documentId, target).then(result => {
      if (cancelled) return;
      const jacket = result.slots[collage ? slotIndex : 0].jacket;
      const canvas = canvasRef.current, img = jacket.img;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!img) { setPrepared(null); return; }
      const view = cropWindow(runtime, page, slotIndex, img, jacket.focusX ?? .5, jacket.focusY ?? .5);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      // 原版全体を暗くし、表紙に見える範囲だけを元の明るさで描き直す。描画コアと同じcover-fitの式で、
      // コラージュは斜めの枠の形のまま重ねる（外接矩形ではなく、実際に見える形）。
      const toCanvas = (x: number, y: number): [number, number] => {
        const imgLeft = view.box.x + view.box.w / 2 - view.cx * img.width * view.scale;
        const imgTop = view.box.y + view.box.h / 2 - view.cy * img.height * view.scale;
        return [(x - imgLeft) / (img.width * view.scale) * canvas.width, (y - imgTop) / (img.height * view.scale) * canvas.height];
      };
      const outline = collage
        ? runtime.layout.COLLAGE.SLOTS[slotIndex].map(([x, y]) => toCanvas(x, y))
        : [[view.box.x, view.box.y], [view.box.x + view.box.w, view.box.y], [view.box.x + view.box.w, view.box.y + view.box.h], [view.box.x, view.box.y + view.box.h]]
          .map(([x, y]) => toCanvas(x, y));
      context.fillStyle = "rgba(0,0,0,.55)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.beginPath();
      outline.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.closePath();
      context.clip();
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      context.restore();
      context.beginPath();
      outline.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.closePath();
      context.strokeStyle = "#c4b5fd";
      context.lineWidth = 3;
      context.stroke();
      setPrepared({ geometry, focusX: view.cx, halfW: view.halfW, halfH: view.halfH });
    }).catch(() => { if (!cancelled) setPrepared(null); });
    return () => { cancelled = true; };
    // ページ背景等は切り抜きに影響しない。選んだジャケットと枠が変わったときだけ準備する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, runtime, signature, slotIndex, collage]);

  if (!slot) return null;
  const ready = prepared?.geometry === geometry ? prepared : null;
  const halfW = ready?.halfW ?? .1, halfH = ready?.halfH ?? .5;
  const clamp = (value: number, half: number) => Math.min(1 - half, Math.max(half, value));
  const positionX = clamp(slot.coverFocusX ?? ready?.focusX ?? .5, halfW);
  const positionY = clamp(slot.coverFocusY ?? .5, halfH);
  const manualX = slot.coverFocusX != null, manualY = slot.coverFocusY != null;
  const slider = (axis: "x" | "y", label: string, position: number, half: number, ends: [string, string]) => (
    <div>
      <label className="block text-xs font-semibold">
        {label}
        <input
          type="range"
          min={half * 100}
          max={(1 - half) * 100}
          step="0.1"
          value={position * 100}
          disabled={disabled || !ready || half >= .5}
          onChange={event => onFocus({ [axis]: Number(event.target.value) / 100 })}
          className="mt-2 block min-h-9 w-full accent-violet-500 disabled:opacity-40"
          aria-valuetext={`${Math.round(position * 100)}%`}
        />
      </label>
      <div className="flex justify-between text-[11px]" style={{ color: "var(--text-secondary)" }}><span>{ends[0]}</span><span>{ends[1]}</span></div>
    </div>
  );

  if (collage) {
    // 正方形のジャケットは、枠の形に応じて縦か横のどちらかにしか動かない。動かない軸は出さない。
    const movableX = ready ? halfW < .499 : true, movableY = ready ? halfH < .499 : true;
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-5" style={{ color: "var(--text-secondary)" }}>
          表紙の枠を押して作品を選べます。明るい範囲が表紙に表示される部分です。位置を動かして「保存」で確定します。
          枠に入るのは採用→掲載の並びの先頭6作品で、入れ替えは「並び順」で行います。
        </p>
        <canvas ref={canvasRef} width={320} height={320} className="mx-auto aspect-square w-full max-w-52 rounded-lg border" style={{ borderColor: "var(--border-subtle)" }} aria-label={`${slot.fields.title}の切り抜き範囲`} />
        {movableX && slider("x", `横位置 · ${manualX ? "手動" : "中央"}`, positionX, halfW, ["左", "右"])}
        {movableY && slider("y", `縦位置 · ${manualY ? "手動" : "中央"}`, positionY, halfH, ["上", "下"])}
        <div className="flex flex-wrap gap-2">
          <SecondaryButton disabled={disabled || (!manualX && !manualY)} onClick={() => onFocus({ x: null, y: null })} className="min-h-9 px-3 text-xs">中央に戻す</SecondaryButton>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-5" style={{ color: "var(--text-secondary)" }}>
        表紙の帯を押して作品を選べます。枠の中が表紙に表示される範囲です。横位置を動かして「保存」で確定します。
      </p>
      <canvas ref={canvasRef} width={320} height={320} className="mx-auto aspect-square w-full max-w-52 rounded-lg border" style={{ borderColor: "var(--border-subtle)" }} aria-label={`${slot.fields.title}の切り抜き範囲`} />
      {slider("x", `横位置 · ${manualX ? "手動" : "自動"}`, positionX, halfW, ["左", "右"])}
      <div className="flex flex-wrap gap-2">
        <SecondaryButton disabled={disabled || !ready} onClick={() => onFocus({ x: .5 })} className="min-h-9 px-3 text-xs">中央にする</SecondaryButton>
        <SecondaryButton disabled={disabled || !manualX} onClick={() => onFocus({ x: null })} className="min-h-9 px-3 text-xs">自動に戻す</SecondaryButton>
      </div>
    </div>
  );
}
