import fs from "node:fs";
import path from "node:path";

/**
 * 「使い方」モーダルの本文。マスターは content/how-to-use.md。
 * 見出し（##）ごとに Section、段落と箇条書き（- **ラベル** — 説明）を順番どおり Block として保持する。
 */
export type HowToUseBlock =
  | { type: "paragraph"; text: string }
  | { type: "items"; items: [string, string][] };

export type HowToUseSection = {
  title: string;
  blocks: HowToUseBlock[];
};

const HEADING_RE = /^##\s+(.+)$/;
const ITEM_RE = /^-\s+\*\*(.+?)\*\*\s+—\s+(.+)$/;

export function parseHowToUse(markdown: string): HowToUseSection[] {
  const sections: HowToUseSection[] = [];
  let current: HowToUseSection | null = null;
  let paragraphLines: string[] = [];
  let items: [string, string][] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0 && current) {
      current.blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
      paragraphLines = [];
    }
  };
  const flushItems = () => {
    if (items.length > 0 && current) {
      current.blocks.push({ type: "items", items });
      items = [];
    }
  };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      flushItems();
      current = { title: heading[1], blocks: [] };
      sections.push(current);
      continue;
    }

    if (!current) continue;

    if (line === "") {
      flushParagraph();
      flushItems();
      continue;
    }

    const item = line.match(ITEM_RE);
    if (item) {
      flushParagraph();
      items.push([item[1], item[2]]);
      continue;
    }

    flushItems();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushItems();

  return sections;
}

export function loadHowToUseSections(): HowToUseSection[] {
  const filePath = path.join(process.cwd(), "content", "how-to-use.md");
  const markdown = fs.readFileSync(filePath, "utf-8");
  return parseHowToUse(markdown);
}
