"use client";

import { useRef, useState } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";
import {
  archiveFileName,
  BulkExportAborted,
  BulkExportBlocked,
  buildArchiveEntries,
  getArchivePacker,
} from "./bulk-export";
import { drawPageInto, preparePage, useGeneratorRuntime, type LegacyPage } from "./runtime";
import type { Tone } from "./ui";

/**
 * 全ページのPNGを1つのファイルにまとめて書き出す。文書単位の操作なので見出し行へ置く。
 *
 * ZIPのまとめ役（`getArchivePacker`）はまだ実装が無い。UIと逐次描画・進捗・中止だけ先に用意し、
 * まとめ役が入るまでは理由を添えて押せない状態で出す。
 */
export default function BulkExportButton({
  document: value,
  pages,
  canExport,
  onStatus,
}: {
  document: GeneratorDocument;
  pages: CanvasPreviewPage[];
  /** 文書全体に未保存が無いか。判定は1枚書き出しと同じものを使う。 */
  canExport: boolean;
  onStatus(status: { tone: Tone; text: string }): void;
}) {
  const { runtime } = useGeneratorRuntime();
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);
  const packer = getArchivePacker();

  const reason = !packer
    ? "まとめて1ファイルにする処理がまだ入っていません。"
    : !runtime
      ? "描画の準備が終わっていません。"
      : !canExport
        ? "共有DBに未保存の変更があります。保存してから書き出せます。"
        : pages.length === 0
          ? "書き出せる画像がありません。"
          : null;

  async function run() {
    if (!runtime || !packer) return;
    abortRef.current = false;
    setRunning(true);
    // 検査と描画で1枚ずつ使い回す下書き用キャンバス。2400pxの本番描画とは別。
    const scratch = window.document.createElement("canvas");
    try {
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
          render: async prepared => (await runtime.exporter.renderTiled(prepared, runtime.images, {
            size: value.theme.outputSize,
            onProgress: () => {},
          })).canvas,
          toBlob: canvas => runtime.exporter.canvasBlob(canvas),
          release: canvas => runtime.exporter.releaseCanvas(canvas),
        },
        onProgress: progress => onStatus({
          tone: "info",
          text: progress.phase === "check"
            ? `書き出せるか確認しています… ${progress.done}/${progress.total}`
            : `PNGを生成しています… ${progress.done}/${progress.total}`,
        }),
        shouldAbort: () => abortRef.current,
      });
      const blob = await packer(entries);
      const name = archiveFileName(value);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onStatus({ tone: "success", text: `${name} に${entries.length}枚を保存しました。` });
    } catch (error) {
      if (error instanceof BulkExportAborted) {
        onStatus({ tone: "warn", text: "書き出しを中止しました。ファイルは作成していません。" });
      } else if (error instanceof BulkExportBlocked) {
        onStatus({ tone: "error", text: `${error.message} ${error.reasons.join("、")}` });
      } else {
        onStatus({ tone: "error", text: `書き出せませんでした: ${(error as Error).message}` });
      }
    } finally {
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
        書き出しを中止
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={Boolean(reason)}
      title={reason || `全${pages.length}枚を${archiveFileName(value)}にまとめます。`}
      onClick={() => void run()}
      className="inline-flex min-h-9 items-center rounded-xl border px-3 text-xs hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      全ページを書き出す{!packer && "（準備中）"}
    </button>
  );
}
