"use client";

import { useRef, useState } from "react";
import { dragRange, formatClock, snapTenth, type RangeDragMode, type VideoRange } from "@/lib/generator/video";

/** 端をつかんだとみなす幅（px）。指でも掴めるよう少し広めにとる。 */
const EDGE = 10;
/** これ以上動いたらクリックではなくドラッグ。 */
const DRAG_THRESHOLD = 3;

type Drag = { mode: RangeDragMode | "click"; x: number; origin: VideoRange; moved: boolean; pointerId: number };

/**
 * 波形の上の範囲。
 * - 紫の範囲をドラッグで移動、両端のつまみで頭・終わりを調整（Shiftを押しながらだと1/5の速さで微調整）
 * - 波形を押す（動かさずに離す）と、その位置から試聴
 * - フォーカス中は ← → で0.1秒、Shift+← → で1秒ずつ動かす
 */
export default function MusicWaveform({ peaks, duration, range, playhead, disabled, onChange, onPlayFrom }: {
  peaks: number[] | null;
  duration: number | null;
  range: VideoRange;
  playhead: number | null;
  disabled: boolean;
  onChange(next: VideoRange): void;
  onPlayFrom(seconds: number): void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [active, setActive] = useState<RangeDragMode | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const track = duration ?? 0;
  const left = track ? (range.start / track) * 100 : 0;
  const width = track ? (Math.min(range.length, track - range.start) / track) * 100 : 0;

  function secondsAt(clientX: number) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || !track) return 0;
    return Math.min(track, Math.max(0, ((clientX - box.left) / box.width) * track));
  }

  function modeAt(clientX: number): Drag["mode"] {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || !track) return "click";
    const startX = box.left + (range.start / track) * box.width, endX = box.left + ((range.start + range.length) / track) * box.width;
    if (Math.abs(clientX - startX) <= EDGE) return "start";
    if (Math.abs(clientX - endX) <= EDGE) return "end";
    if (clientX > startX && clientX < endX) return "move";
    return "click";
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || !track || event.button > 0) return;
    const mode = modeAt(event.clientX);
    dragRef.current = { mode, x: event.clientX, origin: range, moved: false, pointerId: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* なくても動く */ }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) { if (track && !disabled) setHover(secondsAt(event.clientX)); return; }
    if (!drag.moved && Math.abs(event.clientX - drag.x) < DRAG_THRESHOLD) return;
    drag.moved = true;
    if (drag.mode === "click") return;
    setActive(drag.mode);
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const delta = ((event.clientX - drag.x) / box.width) * track * (event.shiftKey ? 0.2 : 1);
    onChange(dragRange(drag.origin, drag.mode, delta, track));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    setActive(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 既に外れている */ }
    if (drag && !drag.moved) onPlayFrom(snapTenth(secondsAt(event.clientX)));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || !track || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const step = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1);
    onChange(dragRange(range, "move", step, track));
  }

  const cursorFor = (clientX: number) => {
    const mode = modeAt(clientX);
    return mode === "start" || mode === "end" ? "ew-resize" : mode === "move" ? "grab" : "pointer";
  };

  return (
    <div>
      <div
        ref={boxRef}
        tabIndex={disabled ? -1 : 0}
        role="slider"
        aria-label="動画に使う範囲の開始位置"
        aria-valuemin={0}
        aria-valuemax={Math.floor(track)}
        aria-valuenow={Math.floor(range.start)}
        aria-valuetext={`${formatClock(range.start, true)} から ${Math.round(range.length)}秒`}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={event => { onPointerMove(event); if (!dragRef.current) event.currentTarget.style.cursor = cursorFor(event.clientX); }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; setActive(null); }}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        // 指で範囲を動かすときにページがスクロールしないようにする
        className="relative h-20 touch-none select-none overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        style={{ backgroundColor: "rgba(0,0,0,.3)", cursor: disabled ? "default" : active === "move" ? "grabbing" : undefined }}
      >
        <div className="pointer-events-none absolute inset-0 flex items-center gap-px px-0.5">
          {(peaks ?? Array.from({ length: 120 }, (_, index) => 0.12 + 0.08 * Math.abs(Math.sin(index / 5)))).map((peak, index, list) => {
            const at = ((index + 0.5) / list.length) * track;
            const inside = Boolean(peaks) && at >= range.start && at <= range.start + range.length;
            return <span key={index} className="flex-1 rounded-[1px]" style={{ height: `${Math.max(4, peak * 90)}%`, backgroundColor: inside ? "rgba(221,214,254,.9)" : "rgba(255,255,255,.28)" }} />;
          })}
        </div>
        {peaks && track > 0 && (
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${left}%`, width: `${width}%`, backgroundColor: "rgba(139,92,246,.22)" }}>
            {/* 両端のつまみ。見た目は細く、掴める幅は EDGE で広くとる */}
            <span className="absolute inset-y-0 -left-px w-1 rounded-sm" style={{ backgroundColor: active === "start" ? "#c4b5fd" : "var(--accent)" }} />
            <span className="absolute inset-y-0 -right-px w-1 rounded-sm" style={{ backgroundColor: active === "end" ? "#c4b5fd" : "var(--accent)" }} />
            <span className="absolute left-1.5 top-1 rounded px-1 text-[10px] tabular-nums text-white" style={{ backgroundColor: "rgba(0,0,0,.45)" }}>{formatClock(range.start, true)}</span>
          </div>
        )}
        {peaks && playhead !== null && track > 0 && (
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(playhead / track) * 100}%` }} />
        )}
        {peaks && hover !== null && !active && (
          <div className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${(hover / track) * 100}%`, backgroundColor: "rgba(255,255,255,.5)" }}>
            <span className="absolute bottom-1 left-1 rounded px-1 text-[10px] tabular-nums text-white" style={{ backgroundColor: "rgba(0,0,0,.55)" }}>{formatClock(hover, true)}</span>
          </div>
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
        <span>0:00</span>
        <span>{track ? formatClock(track) : "--:--"}</span>
      </div>
    </div>
  );
}
