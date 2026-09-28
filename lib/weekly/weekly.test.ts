import { describe, expect, it } from "vitest";
import { parseAotyText, excludeReasonFor } from "./aoty-parse";
import { upcomingFriday, weekWindow, isInWeek, normalizeSheetDate, shiftWeek, weekLabel } from "./week";

describe("週の計算", () => {
  it("金曜はその日、それ以外は次の金曜", () => {
    expect(upcomingFriday("2026-10-02")).toBe("2026-10-02"); // 金
    expect(upcomingFriday("2026-09-28")).toBe("2026-10-02"); // 月
    expect(upcomingFriday("2026-09-26")).toBe("2026-10-02"); // 土
    expect(upcomingFriday("2026-10-01")).toBe("2026-10-02"); // 木
  });

  it("土曜〜金曜の範囲をシートの日付形式で返す（月またぎ）", () => {
    const w = weekWindow("2026-10-02");
    expect(w.sheetFrom).toBe("2026/09/26");
    expect(w.sheetTo).toBe("2026/10/02");
    expect(isInWeek("2026/09/30", w)).toBe(true);  // 邦楽は水曜
    expect(isInWeek("2026/9/26", w)).toBe(true);
    expect(isInWeek("2026/09/25", w)).toBe(false);
    expect(isInWeek("2026/10/03", w)).toBe(false);
    expect(isInWeek("", w)).toBe(false);
    expect(weekLabel(w)).toBe("9/26（土）〜10/2（金）");
  });

  it("金曜以外は受け付けない", () => {
    expect(() => weekWindow("2026-10-01")).toThrow();
  });

  it("週送りと日付の正規化", () => {
    expect(shiftWeek("2026-10-02", -1)).toBe("2026-09-25");
    expect(normalizeSheetDate("2026/9/5")).toBe("2026/09/05");
    expect(normalizeSheetDate("46290")).toBe("");
  });
});

describe("AOTYの貼り付けテキスト", () => {
  const page = [
    "Album of the Year",
    "Upcoming Releases",
    "Popular",
    "Geese",
    "Getting Killed",
    "Oct 2 • LP",
    "Must Hear",
    "Big Thief",
    "Double Infinity",
    "Oct 2 • LP",
    "12",
    "Some Band",
    "Little EP",
    "Oct 2 • EP",
    "Old Legends",
    "Classic Album (Deluxe Edition)",
    "Oct 2 • LP",
    "Live Band",
    "Live at Budokan",
    "Oct 3 • Live",
    "Year End",
    "Next January",
    "Jan 8 • LP",
  ].join("\n");

  it("日付行の直前2行をアーティスト名・作品名として拾う", () => {
    const { entries, skipped } = parseAotyText(page, "2026-10-02");
    expect(skipped).toBe(0);
    expect(entries.map((e) => [e.artist, e.title, e.date])).toEqual([
      ["Geese", "Getting Killed", "2026-10-02"],
      ["Big Thief", "Double Infinity", "2026-10-02"],
      ["Some Band", "Little EP", "2026-10-02"],
      ["Old Legends", "Classic Album (Deluxe Edition)", "2026-10-02"],
      ["Live Band", "Live at Budokan", "2026-10-03"],
      ["Year End", "Next January", "2027-01-08"],
    ]);
  });

  it("EP・デラックス版・ライブ盤は除外理由を付ける", () => {
    const { entries } = parseAotyText(page, "2026-10-02");
    const reasons = Object.fromEntries(entries.map((e) => [e.title, e.excludeReason]));
    expect(reasons["Getting Killed"]).toBeNull();
    expect(reasons["Little EP"]).toBe("EP");
    expect(reasons["Classic Album (Deluxe Edition)"]).toBe("デラックス版");
    expect(reasons["Live at Budokan"]).toBe("ライブ盤");
  });

  it("同じ作品が2ページに跨って出ても1件にまとめる", () => {
    const { entries } = parseAotyText(`${page}\nGeese\nGetting Killed\nOct 2 • LP`, "2026-10-02");
    expect(entries.filter((e) => e.title === "Getting Killed")).toHaveLength(1);
  });

  it("整形済みのタブ区切りも読める", () => {
    const tsv = "2026/10/02\tGetting Killed\tGeese\n2026/10/02\t[EP] Tiny\tSomeone";
    const { entries } = parseAotyText(tsv, "2026-10-02");
    expect(entries).toEqual([
      { date: "2026-10-02", title: "Getting Killed", artist: "Geese", type: "", excludeReason: null },
      { date: "2026-10-02", title: "Tiny", artist: "Someone", type: "EP", excludeReason: "EP" },
    ]);
  });

  it("Mixtapeやタイトルに live を含むだけの作品は除外しない", () => {
    expect(excludeReasonFor("Tape One", "Mixtape")).toBeNull();
    expect(excludeReasonFor("Live Forever Young", "LP")).toBeNull();
  });
});
