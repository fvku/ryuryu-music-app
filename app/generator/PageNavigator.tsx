"use client";

import { useEffect, useRef } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import { drawPageInto, preparePage, useGeneratorRuntime } from "./runtime";
import { Chip } from "./ui";

const THUMBNAIL = 200;

function PageThumbnail({ documentId, page }: { documentId: string; page: CanvasPreviewPage }) {
  const { runtime } = useGeneratorRuntime();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signature = JSON.stringify(page);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    // 編集中は同じページが連続で変わる。200msだけ待ってから描き直す。
    const timer = window.setTimeout(() => {
      void (async () => {
        const prepared = await preparePage(runtime, documentId, page);
        if (cancelled || !canvasRef.current) return;
        drawPageInto(runtime, canvasRef.current, prepared, THUMBNAIL);
      })().catch(() => {});
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, runtime, signature]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMBNAIL}
      height={THUMBNAIL}
      className="block aspect-square h-auto w-full rounded bg-black"
      aria-hidden
    />
  );
}

export default function PageNavigator({
  documentId,
  pages,
  pageIndex,
  onSelect,
  onReorder,
  reorderDirty,
  orientation,
}: {
  documentId: string;
  pages: CanvasPreviewPage[];
  pageIndex: number;
  onSelect(index: number): void;
  onReorder(): void;
  reorderDirty: boolean;
  orientation: "vertical" | "horizontal";
}) {
  const vertical = orientation === "vertical";
  const reorder = (
    <button
      type="button"
      onClick={onReorder}
      className={`flex items-center justify-center gap-1 rounded-lg border text-[11px] hover:bg-white/5 ${vertical ? "min-h-11 w-full shrink-0" : "min-h-[4.5rem] w-24 shrink-0 px-2 text-center"}`}
      style={{ borderColor: "var(--border-subtle)" }}
    >
      並び順を変更
      {reorderDirty && <Chip tone="warn">未保存</Chip>}
    </button>
  );

  return (
    <div className={vertical ? "flex h-full min-h-0 flex-col gap-2" : ""}>
      {vertical && (
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>画像</p>
      )}
      <ul
        className={vertical
          ? "min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
          : "-mx-1 flex items-stretch gap-2 overflow-x-auto px-1 pb-1"}
      >
        {pages.map((page, index) => {
          const active = index === pageIndex;
          return (
            <li key={page.id} className={vertical ? "" : "w-20 shrink-0"}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={active}
                title={page.slots.map(slot => slot.fields.title || "（作品名未入力）").join(" / ")}
                className="w-full rounded-lg border p-1 text-left transition hover:bg-white/5"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                  backgroundColor: active ? "rgba(139,92,246,.12)" : "transparent",
                }}
              >
                <PageThumbnail documentId={documentId} page={page} />
                <span className="mt-0.5 block px-0.5 text-[10px]" style={{ color: active ? "#c4b5fd" : "var(--text-secondary)" }}>
                  {page.no} · {page.kind === "adopted" ? "採用" : "掲載"}
                </span>
              </button>
            </li>
          );
        })}
        {!vertical && <li className="flex shrink-0 items-center">{reorder}</li>}
      </ul>
      {vertical && reorder}
    </div>
  );
}
