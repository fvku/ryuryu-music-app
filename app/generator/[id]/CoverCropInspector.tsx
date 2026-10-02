"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import { preparePage, useGeneratorRuntime } from "../runtime";
import { SecondaryButton } from "../ui";

/** 表紙だけに効く位置調整。自動の切り抜き位置からスライダーを動かし始める。 */
export default function CoverCropInspector({ documentId, page, slotIndex, disabled, onFocus }: {
  documentId: string;
  page: CanvasPreviewPage;
  slotIndex: number;
  disabled: boolean;
  onFocus(value: number | null): void;
}) {
  const { runtime } = useGeneratorRuntime();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [prepared, setPrepared] = useState<{ signature: string; focus: number; halfWidth: number } | null>(null);
  const slot = page.slots[slotIndex];
  const signature = JSON.stringify(slot);

  useEffect(() => {
    if (!runtime || !slot) return;
    let cancelled = false;
    void preparePage(runtime, documentId, { ...page, slots: [slot] }).then(result => {
      if (cancelled) return;
      const jacket = result.slots[0].jacket;
      const canvas = canvasRef.current, img = jacket.img;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!img) { setPrepared(null); return; }
      // 原版全体に、実際に表紙で見える帯を重ねる。非正方形でも描画コアと同じcover-fit。
      const cell = runtime.layout.WEEKLY.COVER.bandCell(0);
      const scale = Math.max(cell.w / img.width, cell.h / img.height);
      const halfWidth = cell.w / (img.width * scale) / 2;
      const focus = Math.min(1 - halfWidth, Math.max(halfWidth, jacket.focusX ?? .5));
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const left = (focus - halfWidth) * canvas.width, width = halfWidth * 2 * canvas.width;
      const height = cell.h / (img.height * scale) * canvas.height;
      const top = (canvas.height - height) / 2;
      context.fillStyle = "rgba(0,0,0,.55)";
      context.fillRect(0, 0, left, canvas.height);
      context.fillRect(left + width, 0, canvas.width - left - width, canvas.height);
      context.fillRect(left, 0, width, top);
      context.fillRect(left, top + height, width, top);
      context.strokeStyle = "#c4b5fd";
      context.lineWidth = 3;
      context.strokeRect(left, top, width, height);
      setPrepared({ signature, focus, halfWidth });
    }).catch(() => { if (!cancelled) setPrepared(null); });
    return () => { cancelled = true; };
    // ページ背景等は切り抜きに影響しない。選んだジャケットが変わったときだけ準備する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, runtime, signature]);

  if (!slot) return null;
  const ready = prepared?.signature === signature ? prepared : null;
  const manual = slot.coverFocusX != null;
  const focus = slot.coverFocusX ?? ready?.focus ?? .5;
  const halfWidth = ready?.halfWidth ?? .1;
  const position = Math.min(1 - halfWidth, Math.max(halfWidth, focus));
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-5" style={{ color: "var(--text-secondary)" }}>
        表紙の帯を押して作品を選べます。枠の中が表紙に表示される範囲です。横位置を動かして「保存」で確定します。
      </p>
      <canvas ref={canvasRef} width={320} height={320} className="mx-auto aspect-square w-full max-w-52 rounded-lg border" style={{ borderColor: "var(--border-subtle)" }} aria-label={`${slot.fields.title}の切り抜き範囲`} />
      <label className="block text-xs font-semibold">
        横位置 · {manual ? "手動" : "自動"}
        <input
          type="range"
          min={halfWidth * 100}
          max={(1 - halfWidth) * 100}
          step="0.1"
          value={position * 100}
          disabled={disabled || !prepared || halfWidth >= .5}
          onChange={event => onFocus(Number(event.target.value) / 100)}
          className="mt-2 block min-h-9 w-full accent-violet-500 disabled:opacity-40"
          aria-valuetext={`${Math.round(position * 100)}%`}
        />
      </label>
      <div className="flex justify-between text-[11px]" style={{ color: "var(--text-secondary)" }}><span>左</span><span>右</span></div>
      <div className="flex flex-wrap gap-2">
        <SecondaryButton disabled={disabled || !prepared} onClick={() => onFocus(.5)} className="min-h-9 px-3 text-xs">中央にする</SecondaryButton>
        <SecondaryButton disabled={disabled || !manual} onClick={() => onFocus(null)} className="min-h-9 px-3 text-xs">自動に戻す</SecondaryButton>
      </div>
    </div>
  );
}
