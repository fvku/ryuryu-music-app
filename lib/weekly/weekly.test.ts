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

  it("実際のコピー（2026-09-28）：画像の代替テキスト・批評スコア・日付入りのライブ盤タイトルが混ざっても崩れない", () => {
    const real = [
      "Patter", "Patter Now", "Oct 2 • LP",
      "Bluhm - Between Dreams", "Bluhm", "Between Dreams", "Oct 2 • LP",
      "The Crystal Teardrop - Love You More", "The Crystal Teardrop", "Love You More", "Oct 2 • LP",
      "80", "critic score (1)",
      "Issadora Ava - In the Living of It", "Issadora Ava", "In the Living of It", "Oct 2 • LP",
      "Scarlet Rose", "Pangea", "Oct 2 • LP",
      "Cinder Well - Small Prophets (Original Soundtrack)", "Cinder Well", "Small Prophets (Original Soundtrack)", "Oct 2 • Soundtrack",
      "Cyndee With A C - JEZEBEL (Extended)", "Cyndee With A C", "JEZEBEL (Extended)", "Oct 2 • LP",
      "Phish - Oct. 3, 2026 | Boardwalk Hall, Atlantic City, NJ", "Phish", "Oct. 3, 2026 | Boardwalk Hall, Atlantic City, NJ", "Oct 3 • Live",
      "Kiyo - TODOS LOS FURROS TE AMAN HASTA QUE MUERDES", "Kiyo", "TODOS LOS FURROS TE AMAN HASTA QUE MUERDES", "Oct 3 • LP",
    ].join("\n");
    const { entries, skipped } = parseAotyText(real, "2026-10-02");
    expect(skipped).toBe(0);
    expect(entries.map((e) => [e.artist, e.title, e.date, e.excludeReason])).toEqual([
      ["Patter", "Patter Now", "2026-10-02", null],
      ["Bluhm", "Between Dreams", "2026-10-02", null],
      ["The Crystal Teardrop", "Love You More", "2026-10-02", null],
      ["Issadora Ava", "In the Living of It", "2026-10-02", null],
      ["Scarlet Rose", "Pangea", "2026-10-02", null],
      ["Cinder Well", "Small Prophets (Original Soundtrack)", "2026-10-02", "サウンドトラック"],
      ["Cyndee With A C", "JEZEBEL (Extended)", "2026-10-02", "拡張版"],
      ["Phish", "Oct. 3, 2026 | Boardwalk Hall, Atlantic City, NJ", "2026-10-03", "ライブ盤"],
      ["Kiyo", "TODOS LOS FURROS TE AMAN HASTA QUE MUERDES", "2026-10-03", null],
    ]);
  });

  it("ページ全体を⌘Aでコピーしても、ヘッダー・サイドバー・月名一覧を作品として拾わない", () => {
    const fullPage = [
      "Search albums, artists, genres etc.", "",
      "Best AlbumsDiscover New Releases Lists Genres News Community Sign In",
      "This WeekThis MonthNew ReleasesUpcoming", "Upcoming Album Releases",
      "Patter - Patter Now", "Patter", "Patter Now", "Oct 2 • LP",
      "Acidgvrl - ROTTËN: THE WORLD TOUR", "Acidgvrl", "ROTTËN: THE WORLD TOUR", "Oct 6 • LP",
      "PREVNEXT", "Advertisement", " Hide Ads", "Highly AnticipatedView More", "",
      "Slayyyter", "WOR$T MAN IN AMERICA", "", "The Avalanches", "No Bad Memories",
      "2026 ReleasesView All", "January", "September", "October", "November", "",
      " September Playlist", "ALBUMS", "Highest Rated", "© 2026 Album of the Year",
    ].join("\n");
    const { entries, skipped } = parseAotyText(fullPage, "2026-10-02");
    expect(skipped).toBe(0);
    expect(entries.map((e) => [e.artist, e.title])).toEqual([
      ["Patter", "Patter Now"],
      ["Acidgvrl", "ROTTËN: THE WORLD TOUR"],
    ]);
  });
});

