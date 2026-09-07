import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";

/** まとめる前の1枚。canvasは解放済みで、ここにはPNGの実体だけが残る。 */
export type ArchiveEntry = { name: string; blob: Blob };

/**
 * 複数のPNGを1つのファイルへまとめる役。
 * **未実装。** 旧スタンドアロン版の無圧縮ZIP実装（stored のみ）を移植する想定で、
 * 担当と実装方針は docs/codex-generator-handoff.md に引き継いである。
 */
export type ArchivePacker = (entries: ArchiveEntry[]) => Promise<Blob>;

/** 実装が入ったらここで返す。UIはこの戻り値がnullの間、一括書き出しを実行できない状態で出す。 */
export function getArchivePacker(): ArchivePacker | null {
  return null;
}

type Named = Pick<GeneratorDocument, "series" | "period">;

function seriesSlug(value: Named): string {
  return value.series === "japan" ? "monthly-japan" : value.series === "weekly" ? "weekly" : "monthly";
}

/** 1枚書き出しと一括書き出しで同じ規則を使う。例: monthly_26_08_02.png */
export function pngFileName(value: Named, no: number): string {
  const [year, month] = value.period.start.slice(0, 7).split("-");
  return `${seriesSlug(value)}_${year.slice(2)}_${month}_${String(no).padStart(2, "0")}.png`;
}

/** まとめたファイルの名前。例: monthly_26_08.zip */
export function archiveFileName(value: Named): string {
  const [year, month] = value.period.start.slice(0, 7).split("-");
  return `${seriesSlug(value)}_${year.slice(2)}_${month}.zip`;
}

/** はみ出し等で1枚でも書き出せない場合は、何も作らずに止める。 */
export class BulkExportBlocked extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("書き出せない画像があります。");
    this.name = "BulkExportBlocked";
    this.reasons = reasons;
  }
}

export class BulkExportAborted extends Error {
  constructor() {
    super("書き出しを中止しました。");
    this.name = "BulkExportAborted";
  }
}

/** 描画コアへの入口。テストから差し替えられるよう、呼び出し側で束ねて渡す。 */
export type BulkExportDeps<Prepared> = {
  prepare(page: CanvasPreviewPage): Promise<Prepared>;
  /** 1枚ずつのはみ出し検査。描画と同じ `inspectPage` を使う。 */
  inspect(prepared: Prepared): string[];
  numberOf(prepared: Prepared): number;
  render(prepared: Prepared): Promise<HTMLCanvasElement>;
  toBlob(canvas: HTMLCanvasElement): Promise<Blob>;
  /** 2400px のキャンバスを持ち続けると落ちるので、1枚ごとに必ず解放する。 */
  release(canvas: HTMLCanvasElement): void;
};

export type BulkProgress = { phase: "check" | "render"; done: number; total: number };

/**
 * 全ページを順に描いてPNGの一覧を作る。
 *
 * - 先に全ページを検査し、1枚でも書き出せなければ何も作らずに止める。
 *   文書全体の未保存で止める既存の条件（仕様書§7）は呼び出し側が先に判定する。
 * - 描画は1枚ずつで、キャンバスは都度解放する。
 * - 中止は各段の区切りで効く。描画中の1枚は最後まで進む。
 */
export async function buildArchiveEntries<Prepared>({
  document: value,
  pages,
  deps,
  onProgress,
  shouldAbort,
}: {
  document: Named;
  pages: CanvasPreviewPage[];
  deps: BulkExportDeps<Prepared>;
  onProgress(progress: BulkProgress): void;
  shouldAbort(): boolean;
}): Promise<ArchiveEntry[]> {
  const total = pages.length;
  const prepared: Prepared[] = [];
  const blocked: string[] = [];

  for (const [index, page] of pages.entries()) {
    if (shouldAbort()) throw new BulkExportAborted();
    const ready = await deps.prepare(page);
    prepared.push(ready);
    const warnings = deps.inspect(ready);
    if (warnings.length > 0) blocked.push(`画像 ${deps.numberOf(ready)}: ${warnings.join(" / ")}`);
    onProgress({ phase: "check", done: index + 1, total });
  }
  if (blocked.length > 0) throw new BulkExportBlocked(blocked);

  const entries: ArchiveEntry[] = [];
  for (const [index, ready] of prepared.entries()) {
    if (shouldAbort()) throw new BulkExportAborted();
    const canvas = await deps.render(ready);
    try {
      entries.push({ name: pngFileName(value, deps.numberOf(ready)), blob: await deps.toBlob(canvas) });
    } finally {
      deps.release(canvas);
    }
    onProgress({ phase: "render", done: index + 1, total });
  }
  return entries;
}
