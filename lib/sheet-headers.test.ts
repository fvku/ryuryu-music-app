import { describe, it, expect } from "vitest";
import {
  buildHeaderMap,
  findMissingColumns,
  indexToColumnLetter,
  getCol,
  getWriteCol,
  SHEET_COL,
} from "@/lib/sheet-headers";

describe("buildHeaderMap", () => {
  it("maps header names to their 0-based index", () => {
    const map = buildHeaderMap(["No.", "日付", "アルバム名"]);
    expect(map["No."]).toBe(0);
    expect(map["日付"]).toBe(1);
    expect(map["アルバム名"]).toBe(2);
  });

  it("trims whitespace from header cells", () => {
    const map = buildHeaderMap([" No. ", "  日付"]);
    expect(map["No."]).toBe(0);
    expect(map["日付"]).toBe(1);
  });

  it("skips empty cells", () => {
    const map = buildHeaderMap(["No.", "", "アルバム名"]);
    expect(map["アルバム名"]).toBe(2);
    expect(Object.keys(map)).not.toContain("");
  });

  it("registers a normalized (dash-unified) alias alongside the original", () => {
    const map = buildHeaderMap(["M/J採用（220-300）"]);
    expect(map["M/J採用（220-300）"]).toBe(0);
    expect(map["M/J採用（220−300）"]).toBe(0);
  });

  it("returns an empty map for an undefined/empty header row", () => {
    expect(buildHeaderMap(undefined as unknown as string[])).toEqual({});
    expect(buildHeaderMap([])).toEqual({});
  });
});

describe("findMissingColumns", () => {
  it("returns columns absent from the map", () => {
    const map = buildHeaderMap(["No.", "日付"]);
    expect(findMissingColumns(map, ["No.", "アルバム名"])).toEqual(["アルバム名"]);
  });

  it("returns an empty array when all required columns are present", () => {
    const map = buildHeaderMap(["No.", "日付"]);
    expect(findMissingColumns(map, ["No.", "日付"])).toEqual([]);
  });

  it("matches required columns via their normalized form", () => {
    const map = buildHeaderMap(["Start−Time"]); // stored with MINUS SIGN
    expect(findMissingColumns(map, ["Start-Time"])).toEqual([]); // required uses hyphen
  });
});

describe("indexToColumnLetter", () => {
  it("converts single-letter indices", () => {
    expect(indexToColumnLetter(0)).toBe("A");
    expect(indexToColumnLetter(25)).toBe("Z");
  });

  it("converts double-letter indices", () => {
    expect(indexToColumnLetter(26)).toBe("AA");
    expect(indexToColumnLetter(27)).toBe("AB");
    expect(indexToColumnLetter(29)).toBe("AD");
  });
});

describe("getCol", () => {
  it("resolves a column index by its exact header name", () => {
    const map = buildHeaderMap(["No.", "日付", "アルバム名", "アーティスト", "E", "ジャンル"]);
    expect(getCol(map, "GENRE")).toBe(5);
  });

  it("resolves via normalization when the sheet uses a different dash variant than SHEET_COL", () => {
    // sheet header uses a full-width hyphen-minus (－); SHEET_COL.MJ_TEXT uses U+2212
    const map = buildHeaderMap(["UID", "M/J採用（220－300）"]);
    expect(getCol(map, "MJ_TEXT")).toBe(1);
  });

  it("falls back to SHEET_COL_FALLBACK for known read-only columns when missing from the map", () => {
    const map = buildHeaderMap(["something-else"]);
    expect(getCol(map, "NO")).toBe(0);
    expect(getCol(map, "TITLE")).toBe(2);
  });

  it("returns -1 for a write-only column that is missing and has no fallback", () => {
    const map = buildHeaderMap(["something-else"]);
    expect(getCol(map, "UID")).toBe(-1);
  });
});

describe("getWriteCol", () => {
  it("resolves a column index by exact name", () => {
    const map = buildHeaderMap(["UID", "国"]);
    expect(getWriteCol(map, SHEET_COL.COUNTRY)).toBe(1);
  });

  it("resolves via normalized name", () => {
    const map = buildHeaderMap(["Start−Time"]);
    expect(getWriteCol(map, "Start-Time")).toBe(0);
  });

  it("returns -1 when the column name cannot be resolved", () => {
    const map = buildHeaderMap(["UID"]);
    expect(getWriteCol(map, "存在しない列")).toBe(-1);
  });
});
