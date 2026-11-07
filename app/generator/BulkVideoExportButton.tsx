"use client";

import { useRef, useState } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";
import { archiveFileName, BulkExportAborted, BulkExportBlocked, buildArchiveEntries, getArchivePacker, pngFileName } from "./bulk-export";
import { useMusic, videoPage } from "./music-store";
import { drawPageInto, preparePage, useGeneratorRuntime, waveWarnings, type LegacyPage } from "./runtime";
import { buildVideo, downloadFile, planVideo, progressText, VideoAborted, VideoNotReady, videoSupportProblem, type VideoPlan } from "./video-export";
import type { Tone } from "./ui";

/**
 * 全ページを1つのZIPへ。表紙はPNG、採用・掲載はそれぞれの曲を付けたMP4にする。
 * 音楽が未設定の画像が1枚でもあれば書き出さず、その画像番号を知らせて音楽タブを開く。
 * 検査・描画・中止は「全ページを書き出す（ZIP）」と同じまとめ役（buildArchiveEntries）を使う。
 */
export default function BulkVideoExportButton({ document: value, pages, onStatus, onOpenMusic }: {
  document: GeneratorDocument;
  pages: CanvasPreviewPage[];
  onStatus(status: { tone: Tone; text: string }): void;
  /** 未設定の先頭の画像を開き、音楽タブへ切り替える。 */
  onOpenMusic(pageNo: number): void;
}) {
  const music = useMusic();
  const { runtime } = useGeneratorRuntime();
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);
  if (!music) return null;

  const videoPages = pages.filter(videoPage);
  const missing = videoPages.filter(page => !music.status(page)?.ready).map(page => page.no);
  const packer = getArchivePacker();
  const reason = !runtime
    ? "描画の準備が終わっていません。"
    : videoPages.length === 0
      ? "動画にできる画像がありません。"
      : waveWarnings(runtime)[0] ?? null;

  async function run() {
    if (!music || !runtime || !packer || running) return;
    if (missing.length) {
      onStatus({ tone: "warn", text: `音楽が未設定の画像があります（画像 ${missing.join("・")}）。右の「音楽」タブで音声ファイルを選んでください。` });
      onOpenMusic(missing[0]);
      return;
    }
    abortRef.current = false;
    setRunning(true);
    const scratch = window.document.createElement("canvas");
    try {
      const problem = await videoSupportProblem();
      if (problem) { onStatus({ tone: "error", text: problem }); return; }
      const plans = new Map<string, VideoPlan>();
      for (const page of videoPages) plans.set(page.id, planVideo(music, page, pngFileName(value, page.no)));
      const total = pages.length;
      let videos = 0, images = 0;
      const entries = await buildArchiveEntries<LegacyPage>({
        document: value,
        pages,
        deps: {
          prepare: page => preparePage(runtime, value.id, page),
          inspect: prepared => {
            const context = drawPageInto(runtime, scratch, prepared, 1200);
            return context ? runtime.renderer.inspectPage(context, prepared) : ["描画領域を準備できませんでした。"];
          },
          numberOf: prepared => prepared.no,
          render: async prepared => (await runtime.exporter.renderTiled(prepared, runtime.images, { size: value.theme.outputSize, onProgress: () => {} })).canvas,
          toBlob: canvas => runtime.exporter.canvasBlob(canvas),
          release: canvas => runtime.exporter.releaseCanvas(canvas),
          async entry(prepared, canvas) {
            const plan = plans.get(prepared.id);
            if (!plan) {
              images += 1;
              return { name: pngFileName(value, prepared.no), blob: await runtime.exporter.canvasBlob(canvas) };
            }
            const index = pages.findIndex(page => page.id === prepared.id) + 1;
            const built = await buildVideo({
              plan,
              image: canvas,
              onProgress: progress => onStatus({ tone: "info", text: progressText(progress, `${index}/${total} 画像 ${prepared.no}: `) }),
              shouldAbort: () => abortRef.current,
            });
            videos += 1;
            return { name: built.file.name, blob: built.file };
          },
        },
        onProgress: progress => {
          if (progress.phase === "check") onStatus({ tone: "info", text: `書き出せるか確認しています… ${progress.done}/${progress.total}` });
        },
        shouldAbort: () => abortRef.current,
      });
      const name = archiveFileName(value).replace(/\.zip$/i, "_動画.zip");
      onStatus({ tone: "info", text: "ZIPにまとめています…" });
      downloadFile(await packer(entries), name);
      onStatus({ tone: "success", text: `${name} に${images ? `画像${images}枚（PNG）と` : ""}動画${videos}本（MP4）を保存しました。` });
    } catch (error) {
      if (error instanceof BulkExportAborted || error instanceof VideoAborted) {
        onStatus({ tone: "warn", text: "書き出しを中止しました。ファイルは作成していません。" });
      } else if (error instanceof BulkExportBlocked) {
        onStatus({ tone: "error", text: `${error.message} ${error.reasons.join("、")}` });
      } else if (error instanceof VideoNotReady) {
        onStatus({ tone: "warn", text: `${error.message} ファイルは作成していません。` });
        onOpenMusic(error.pageNumbers[0]);
      } else {
        onStatus({ tone: "error", text: `書き出せませんでした: ${(error as Error).message}` });
      }
    } finally {
      scratch.width = 0; scratch.height = 0;
      setRunning(false);
    }
  }

  if (running) {
    return (
      <button
        type="button"
        onClick={() => { abortRef.current = true; }}
        className="inline-flex min-h-9 items-center rounded-xl border px-3 text-xs hover:bg-white/5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        動画の書き出しを中止
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={Boolean(reason)}
      title={reason || (missing.length
        ? `音楽が未設定: 画像 ${missing.join("・")}`
        : `表紙はPNG、ほかの${videoPages.length}枚はそれぞれの曲を付けたMP4（1080px）にして、1つのZIPにまとめます。`)}
      onClick={() => void run()}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: "var(--border-accent)", color: "#ddd6fe" }}
    >
      全ページを動画つきで書き出す（ZIP）
      {missing.length > 0 && <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">音楽未設定 {missing.length}</span>}
    </button>
  );
}
