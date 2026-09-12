"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import wave202601 from "@/tools/generator-lab/assets/waves/wave2601.png";
import wave202602 from "@/tools/generator-lab/assets/waves/wave2602.png";
import wave202603 from "@/tools/generator-lab/assets/waves/wave2603.png";
import wave202604 from "@/tools/generator-lab/assets/waves/wave2604.png";
import wave202605 from "@/tools/generator-lab/assets/waves/wave2605.png";
import wave202606 from "@/tools/generator-lab/assets/waves/wave2606.png";
import wave202607 from "@/tools/generator-lab/assets/waves/wave2607.png";
import wave202608 from "@/tools/generator-lab/assets/waves/wave2608.png";
import wave202609 from "@/tools/generator-lab/assets/waves/wave2609.png";
import wave202610 from "@/tools/generator-lab/assets/waves/wave2610.png";
import wave202611 from "@/tools/generator-lab/assets/waves/wave2611.png";
import wave202612 from "@/tools/generator-lab/assets/waves/wave2612.png";
import weeklyLogoAsset from "@/tools/generator-lab/assets/hyoryu_logo_brush_1line_white.svg";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";
import type { ReleaseMasterAlbum } from "@/lib/types";
import { pickWaveMonth, waveMonthWarning, type WaveChoice } from "./wave-month";

export type LegacySlot = CanvasPreviewPage["slots"][number] & { jacket: { img: HTMLImageElement | null }; bgColor?: string };
export type LegacyPage = Omit<CanvasPreviewPage, "slots"> & { slots: LegacySlot[] };
export type PageImages = { wave: HTMLImageElement | null; background: HTMLImageElement | null; logo: HTMLImageElement | null };
type BandSegment = { text: string; key?: string };
type DrawData = {
  body: string;
  tracking: number;
  kerns: Record<string, number> | null;
  bodyLeadMode: "auto" | "custom";
  bodyMaxLead: number;
  typography: CanvasPreviewPage["slots"][number]["typography"];
  meta: BandSegment[];
  rec: BandSegment[];
};
type WeeklyDrawData = Pick<DrawData, "tracking" | "kerns" | "typography" | "meta"> & { title: string; artist: string };

export type Cell = { x: number; y: number; w: number; h: number };
/** layoutParagraph が返す行。`at` は原稿の文字位置、`adv` は送り幅（どちらも描画が使う値そのもの）。 */
export type BodyCluster = { at: number; len: number; adv: number; text: string; space: boolean };
export type BodyLine = { clusters: BodyCluster[]; width: number; start: number; end: number; paragraphEnd: boolean };

type Renderer = {
  drawPage(context: CanvasRenderingContext2D, page: LegacyPage, images: PageImages): void;
  inspectPage(context: CanvasRenderingContext2D, page: LegacyPage): string[];
  bodyLineCount(context: CanvasRenderingContext2D, text: string, tracking: number, kerns: Record<string, number> | null): number;
  bodyLines(context: CanvasRenderingContext2D, text: string, tracking: number, kerns: Record<string, number> | null): BodyLine[];
  titleLinesOf(context: CanvasRenderingContext2D, text: string, cell: Cell): string[];
};
type LayoutModule = {
  CANVAS: number;
  CELLS: { jacket: Cell; title: Cell; meta: Cell; body: Cell; rec: Cell };
  LISTED: { cellsOf(index: number): { jacket: Cell; title: Cell; meta: Cell; rec: Cell } };
  TEXT: { bodyX: number; bodyW: number; titleLead: number; bodyAscent: number; bodyDescent: number };
  TYPE: { body: { size: number }; meta: { size: number }; rec: { size: number } };
  titleBaselines(cell: Cell, lineCount: number): { title: number; artist: number };
  bodyLayoutFor(lineCount: number, maxLead?: number): { lead: number; baseline: number };
  bodyFits(lineCount: number): boolean;
  WEEKLY: {
    CELLS: { jacket: Cell; panel: Cell };
    META_CELL: Cell;
    TITLE_INSET_X: number;
    TITLE_BASELINE: number;
    ARTIST_BASELINE: number;
    TYPE: { title: { size: number }; artist: { size: number }; meta: { size: number } };
    OTHERS: { BODY: { BOX: Cell }; TYPE: { body: { size: number } }; layoutFor(lineCount: number): { lead: number; baseline: number }; fits(lineCount: number): boolean };
  };
};
type PagesModule = {
  toDrawData(slot: CanvasPreviewPage["slots"][number]): DrawData;
  toWeeklyDrawData(slot: CanvasPreviewPage["slots"][number]): WeeklyDrawData;
  toWeeklyOtherLine(slot: CanvasPreviewPage["slots"][number]): string;
};
export type BandLayout = { parts: { key: string | null; width: number }[]; gap: number; total: number; cell: Cell };
type TextLayoutModule = {
  bandLayout(
    context: CanvasRenderingContext2D,
    segments: BandSegment[],
    base: { size: number },
    cell: Cell,
    typography: DrawData["typography"],
  ): BandLayout;
};
export type Exporter = {
  renderTiled(page: LegacyPage, images: PageImages, options: { size: 1200 | 2400; onProgress(current: number, total: number): void }): Promise<{ canvas: HTMLCanvasElement }>;
  canvasBlob(canvas: HTMLCanvasElement): Promise<Blob>;
  releaseCanvas(canvas: HTMLCanvasElement): void;
};

/**
 * 月ごとの波。**素材は月替わりで、Koheiが月ごとに原版を渡す**
 * （`docs/generator-weekly-design.md` §6.5・§9-3）。原版は未加工のまま受け取り、
 * `node tools/generator-lab/make-wave.mjs <原版.png>` でグレースケールへ変換してここへ足す
 * （背景の合成はLuminosityで輝度しか使わないので、色を落としても出力は変わらない）。
 *
 * 使う月は**文書の`period.start`が属する暦月**。Weeklyの`period.start`は投稿金曜なので、
 * 週が月をまたいでも金曜の側の月になる（Koheiの決定、2026-09-09）。
 */
export const BUNDLED_WAVES: Readonly<Record<string, string>> = {
  "2026-01": wave202601.src,
  "2026-02": wave202602.src,
  "2026-03": wave202603.src,
  "2026-04": wave202604.src,
  "2026-05": wave202605.src,
  "2026-06": wave202606.src,
  "2026-07": wave202607.src,
  "2026-08": wave202608.src,
  "2026-09": wave202609.src,
  "2026-10": wave202610.src,
  "2026-11": wave202611.src,
  "2026-12": wave202612.src,
};

/**
 * 対象月の波を選ぶ。選び方と警告文は`wave-month.ts`（画像を持たない純粋なロジック）にあり、
 * ここは登録済みの月の一覧と実ファイルを結び付けるだけ。
 */
export function waveForMonth(month: string): WaveChoice & { src: string } {
  const choice = pickWaveMonth(Object.keys(BUNDLED_WAVES), month);
  return { ...choice, src: BUNDLED_WAVES[choice.month] ?? BUNDLED_WAVES[Object.keys(BUNDLED_WAVES)[0]] };
}

/** 対象月の波が無いまま描いているときの警告。プレビューと一括書き出しの両方で使う。 */
export function waveWarnings(runtime: GeneratorRuntime | null): string[] {
  return waveMonthWarning(runtime?.wave ?? null);
}

export type GeneratorRuntime = {
  renderer: Renderer;
  layout: LayoutModule;
  pages: PagesModule;
  textLayout: TextLayoutModule;
  exporter: Exporter;
  images: PageImages;
  coversByUid: Map<string, string>;
  coversByNo: Map<string, string>;
  coverFontReady(): boolean;
  /** 実際に使った波の月・本来使うべき月・対象月の素材がそろっていたか。警告表示に使う。 */
  wave: WaveChoice | null;
};

export const FALLBACK_BACKGROUND = "#475569";

let fontsReady: Promise<void> | null = null;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function requestImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  if (src.startsWith("https://")) image.crossOrigin = "anonymous";
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("画像を読み込めませんでした。")), { once: true });
  });
  image.src = src;
  // decode() はタブが非表示のあいだ解決しないことがある（画面を伏せた・別タブへ移った直後など）。
  // load まで待てば drawImage には足りるので、先に決まったほうを使う。描画結果は変わらない。
  // decode() の失敗だけで load 成功の可能性を捨てない。古いSafariやメモリ圧迫時には
  // decode() が先に拒否されても、load 済みの画像は drawImage できる場合がある。
  const decoded = image.decode().then(() => image).catch(() => loaded);
  return Promise.race([decoded, loaded]);
}

/** 同じジャケットを一覧のサムネイルと大きなプレビューで二重に取りにいかない。 */
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const request = requestImage(src).catch(error => {
    imageCache.delete(src);
    throw error;
  });
  imageCache.set(src, request);
  return request;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && value.length <= 2000 ? url.toString() : null;
  } catch {
    return null;
  }
}

function coverMaps(albums: ReleaseMasterAlbum[]) {
  const coversByUid = new Map<string, string>(), coversByNo = new Map<string, string>();
  for (const album of albums) {
    const cover = httpsUrl(album.coverUrl);
    if (!cover) continue;
    if (album.uid) coversByUid.set(album.uid, cover);
    if (album.no) coversByNo.set(album.no, cover);
  }
  return { coversByUid, coversByNo };
}

export function assetUrl(documentId: string, assetId: string): string {
  return `/api/generator/documents/${documentId}/assets/${assetId}`;
}

/**
 * 1枠ぶんのジャケットの取得先。ページ全体を組まずに1枚だけ要るとき（背景色の抽出）に使う。
 * 解決の順番は `preparePage` と同じ。
 */
export function jacketSource(runtime: GeneratorRuntime, documentId: string, slot: CanvasPreviewPage["slots"][number]): string | null {
  return (slot.jacketAssetId && assetUrl(documentId, slot.jacketAssetId))
    || httpsUrl(slot.sourceCoverUrl || "")
    || (slot.sourceUid && runtime.coversByUid.get(slot.sourceUid))
    || (slot.sourceNo && runtime.coversByNo.get(slot.sourceNo))
    || null;
}

/** 取得先が分かっている1枚を読む。キャッシュは一覧・プレビューと共用する。 */
export function loadJacket(src: string): Promise<HTMLImageElement> {
  return loadImage(src);
}

/** ジャケットを解決して、描画コアが受け取れる形のページにする。 */
export async function preparePage(runtime: GeneratorRuntime, documentId: string, page: CanvasPreviewPage): Promise<LegacyPage> {
  if (page.kind === "cover" && !runtime.coverFontReady()) throw new Error("Weekly表紙に必要な書体を読み込めません。");
  // Other Releasesは文字リストのみ。使わないジャケットを30件読み込まない。
  const sources = page.slots.map(slot => page.kind === "others" ? null :
    (slot.jacketAssetId && assetUrl(documentId, slot.jacketAssetId))
    || httpsUrl(slot.sourceCoverUrl || "")
    || (slot.sourceUid && runtime.coversByUid.get(slot.sourceUid))
    || (slot.sourceNo && runtime.coversByNo.get(slot.sourceNo))
    || null);
  const jackets = await Promise.all(sources.map(source => source ? loadImage(source).catch(() => null) : Promise.resolve(null)));
  const bgColor = page.bgColor || FALLBACK_BACKGROUND;
  return {
    ...page,
    bgColor,
    slots: page.slots.map((slot, index) => ({ ...slot, jacket: { img: jackets[index] }, ...(index === 0 ? { bgColor } : {}) })),
  };
}

/**
 * 1200px基準で組まれた描画コアを、任意の辺長のcanvasへ写す。
 * 変倍は座標変換だけで行うので、版面の規則には手を入れていない。
 */
export function drawPageInto(runtime: GeneratorRuntime, canvas: HTMLCanvasElement, page: LegacyPage, size: number): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const ratio = size / runtime.layout.CANVAS;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  runtime.renderer.drawPage(context, page, runtime.images);
  return context;
}

type RuntimeState = { runtime: GeneratorRuntime | null; error: string | null; stalled: boolean; retry(): void };
const RuntimeContext = createContext<RuntimeState>({ runtime: null, error: null, stalled: false, retry: () => {} });

export function useGeneratorRuntime(): RuntimeState {
  return useContext(RuntimeContext);
}

export function GeneratorRuntimeProvider({
  documentId,
  theme,
  period,
  children,
}: {
  documentId: string;
  theme: GeneratorDocument["theme"];
  /** 文書の対象期間。`start`が属する暦月の波を使う。 */
  period: GeneratorDocument["period"];
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState<GeneratorRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [stalled, setStalled] = useState(false);
  const { useWave, waveAssetId, backgroundAssetId } = theme;
  const month = period.start.slice(0, 7);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [rendererModule, layoutModule, pagesModule, textLayoutModule, fontsModule, exporterModule, albums] = await Promise.all([
          import("@/tools/generator-lab/core/render.mjs"),
          import("@/tools/generator-lab/core/layout.mjs"),
          import("@/tools/generator-lab/core/pages.mjs"),
          import("@/tools/generator-lab/core/text-layout.mjs"),
          import("@/tools/generator-lab/core/fonts.mjs"),
          import("@/tools/generator-lab/tiled-renderer.mjs"),
          fetch("/api/release-master", { cache: "no-store" }).then(async response => {
            // 新しい文書はsource.coverUrlを持つ。Release Masterの再取得は古い文書用の
            // フォールバックなので、一時的に読めなくてもプレビュー全体は止めない。
            if (!response.ok) return [];
            return await response.json() as ReleaseMasterAlbum[];
          }),
        ]);
        fontsReady ||= fontsModule.default.loadAll();
        // 対象月の波は1回だけ解決して、読み込みと警告表示で同じ結果を使う
        const selected = waveForMonth(month);
        const [wave, background, logo] = await Promise.all([
          useWave ? loadImage(waveAssetId ? assetUrl(documentId, waveAssetId) : selected.src) : Promise.resolve(null),
          backgroundAssetId ? loadImage(assetUrl(documentId, backgroundAssetId)) : Promise.resolve(null),
          loadImage(weeklyLogoAsset.src).catch(() => null),
          fontsReady,
        ]);
        if (cancelled) return;
        setRuntime({
          renderer: rendererModule.default as Renderer,
          layout: layoutModule.default as LayoutModule,
          pages: pagesModule.default as PagesModule,
          textLayout: textLayoutModule as TextLayoutModule,
          exporter: exporterModule as Exporter,
          images: { wave, background, logo },
          coverFontReady: fontsModule.default.coverFontReady,
          wave: useWave && !waveAssetId ? { month: selected.month, requested: selected.requested, exact: selected.exact } : null,
          ...coverMaps(albums),
        });
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt, backgroundAssetId, documentId, month, useWave, waveAssetId]);

  /** 書体や描画モジュールが揃わないまま止まると画面には何も起きない。時間で気づけるようにする。 */
  useEffect(() => {
    if (runtime) return;
    const timer = window.setTimeout(() => setStalled(true), 15000);
    return () => window.clearTimeout(timer);
  }, [attempt, runtime]);

  const retry = useCallback(() => {
    fontsReady = null;
    setStalled(false);
    setError(null);
    setAttempt(current => current + 1);
  }, []);

  const value = useMemo<RuntimeState>(() => ({ runtime, error, stalled, retry }), [error, retry, runtime, stalled]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}
