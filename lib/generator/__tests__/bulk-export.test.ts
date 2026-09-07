import { describe, expect, it } from "vitest";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import {
  archiveFileName,
  BulkExportAborted,
  BulkExportBlocked,
  buildArchiveEntries,
  getArchivePacker,
  pngFileName,
  type BulkProgress,
} from "@/app/generator/bulk-export";

const doc = { series: "monthly" as const, period: { type: "month" as const, start: "2026-08-01", end: "2026-09-01" } };
const pages = [{ no: 2 }, { no: 3 }, { no: 4 }] as unknown as CanvasPreviewPage[];

type Prepared = { no: number };

function deps(overrides: Partial<{
  inspect(prepared: Prepared): string[];
  render(prepared: Prepared): Promise<HTMLCanvasElement>;
}> = {}) {
  const released: number[] = [];
  const rendered: number[] = [];
  const base = {
    prepare: async (page: CanvasPreviewPage) => ({ no: (page as unknown as Prepared).no }),
    inspect: () => [],
    numberOf: (prepared: Prepared) => prepared.no,
    render: async (prepared: Prepared) => {
      rendered.push(prepared.no);
      return { no: prepared.no } as unknown as HTMLCanvasElement;
    },
    toBlob: async () => new Blob(["png"]),
    release: (canvas: HTMLCanvasElement) => { released.push((canvas as unknown as Prepared).no); },
    ...overrides,
  };
  return { base, released, rendered };
}

describe("全ページのPNG書き出し", () => {
  it("1枚書き出しと同じ命名規則を使う", () => {
    expect(pngFileName(doc, 2)).toBe("monthly_26_08_02.png");
    expect(pngFileName({ ...doc, series: "japan" }, 12)).toBe("monthly-japan_26_08_12.png");
    expect(archiveFileName(doc)).toBe("monthly_26_08.zip");
  });

  it("全ページを順に描き、1枚ごとにキャンバスを解放する", async () => {
    const { base, released, rendered } = deps();
    const entries = await buildArchiveEntries({ document: doc, pages, deps: base, onProgress: () => {}, shouldAbort: () => false });
    expect(entries.map(entry => entry.name)).toEqual([
      "monthly_26_08_02.png",
      "monthly_26_08_03.png",
      "monthly_26_08_04.png",
    ]);
    expect(rendered).toEqual([2, 3, 4]);
    expect(released).toEqual([2, 3, 4]);
  });

  it("はみ出しが1枚でもあれば、何も描かずに理由をまとめて止める", async () => {
    const { base, rendered } = deps({ inspect: (prepared: Prepared) => prepared.no === 3 ? ["評価文が枠に収まりません"] : [] });
    await expect(buildArchiveEntries({ document: doc, pages, deps: base, onProgress: () => {}, shouldAbort: () => false }))
      .rejects.toBeInstanceOf(BulkExportBlocked);
    expect(rendered).toEqual([]);
  });

  it("描画で失敗してもそのキャンバスを解放する", async () => {
    const { base, released } = deps();
    const failing = {
      ...base,
      toBlob: async () => { throw new Error("blobを作れません"); },
    };
    await expect(buildArchiveEntries({ document: doc, pages, deps: failing, onProgress: () => {}, shouldAbort: () => false }))
      .rejects.toThrow("blobを作れません");
    expect(released).toEqual([2]);
  });

  it("中止すると、それ以降を描かずに止める", async () => {
    const { base, rendered } = deps();
    let calls = 0;
    await expect(buildArchiveEntries({
      document: doc,
      pages,
      deps: base,
      onProgress: () => {},
      // 検査3回のあと、描画の1枚目の前で中止する。
      shouldAbort: () => ++calls > 4,
    })).rejects.toBeInstanceOf(BulkExportAborted);
    expect(rendered).toEqual([2]);
  });

  it("検査と描画の進捗を、段階つきで報告する", async () => {
    const { base } = deps();
    const seen: BulkProgress[] = [];
    await buildArchiveEntries({ document: doc, pages, deps: base, onProgress: value => seen.push(value), shouldAbort: () => false });
    expect(seen.filter(value => value.phase === "check").map(value => value.done)).toEqual([1, 2, 3]);
    expect(seen.filter(value => value.phase === "render").map(value => value.done)).toEqual([1, 2, 3]);
    expect(seen.every(value => value.total === 3)).toBe(true);
  });

  it("まとめ役はまだ実装されていない（実装されたらこのテストを消す）", () => {
    expect(getArchivePacker()).toBeNull();
  });
});
