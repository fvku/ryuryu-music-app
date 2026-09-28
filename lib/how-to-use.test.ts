import { describe, it, expect } from "vitest";
import { parseHowToUse, loadHowToUseSections } from "@/lib/how-to-use";

describe("parseHowToUse", () => {
  it("見出し・段落・箇条書きを順番どおりブロックへ分ける", () => {
    const markdown = `## セクションA

前置きの段落。

- **ラベル1** — 説明1
- **ラベル2** — 説明2

後書きの段落。

## セクションB

Bの段落だけ。
`;
    const sections = parseHowToUse(markdown);

    expect(sections).toEqual([
      {
        title: "セクションA",
        blocks: [
          { type: "paragraph", text: "前置きの段落。" },
          { type: "items", items: [["ラベル1", "説明1"], ["ラベル2", "説明2"]] },
          { type: "paragraph", text: "後書きの段落。" },
        ],
      },
      {
        title: "セクションB",
        blocks: [{ type: "paragraph", text: "Bの段落だけ。" }],
      },
    ]);
  });

  it("見出しの前の本文は無視する", () => {
    const markdown = `これは見出しが来る前の行。

## セクション

本文。
`;
    const sections = parseHowToUse(markdown);
    expect(sections).toEqual([
      { title: "セクション", blocks: [{ type: "paragraph", text: "本文。" }] },
    ]);
  });

  it("空文字列からは空配列を返す", () => {
    expect(parseHowToUse("")).toEqual([]);
  });
});

describe("loadHowToUseSections", () => {
  it("content/how-to-use.md を読み込み、空でないセクション一覧を返す", () => {
    const sections = loadHowToUseSections();
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });
});
