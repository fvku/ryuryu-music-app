"use client";

import { useEffect } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import { coverColorCandidates, type CoverColor } from "@/lib/generator/cover-color";
import { jacketSource, loadJacket, useGeneratorRuntime, type GeneratorRuntime } from "./runtime";

const SAMPLE = 32;

/**
 * その画像のジャケットから背景色の候補を出す。
 * 画素はブラウザで読む。ジャケットは描画と同じ `crossOrigin="anonymous"` で読み込んでいるので、
 * canvasは汚染されない。読めない場合は候補なしを返し、操作は止めない。
 */
export async function coverColorsFor(runtime: GeneratorRuntime, documentId: string, page: CanvasPreviewPage): Promise<CoverColor[]> {
  const slot = page.slots[0];
  if (!slot) return [];
  const source = jacketSource(runtime, documentId, slot);
  if (!source) return [];
  try {
    const image = await loadJacket(source);
    const canvas = window.document.createElement("canvas");
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    return coverColorCandidates(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    // 画像が読めない、canvasが汚染されている等。背景色は人が決められるので、ここでは黙って諦める。
    return [];
  }
}

/**
 * 表示中の画像の候補を1度だけ拾って返す。描画コアの provider の中でしか runtime を読めないので、
 * 画面本体ではなくこの小さな部品が担当する。描画は何も出さない。
 */
export function CoverColorProbe({ documentId, pageId, source, known, onColors }: {
  documentId: string;
  pageId: string;
  /** 候補を拾う元。表紙のように作品を持たない画像では、別の画像を渡す。 */
  source: CanvasPreviewPage | null;
  known: boolean;
  onColors(pageId: string, colors: string[]): void;
}) {
  const { runtime } = useGeneratorRuntime();
  useEffect(() => {
    if (!runtime || !source || known) return;
    let cancelled = false;
    void coverColorsFor(runtime, documentId, source).then(values => {
      if (!cancelled && values.length) onColors(pageId, values.map(value => value.hex));
    });
    return () => { cancelled = true; };
  }, [documentId, known, onColors, pageId, runtime, source]);
  return null;
}
