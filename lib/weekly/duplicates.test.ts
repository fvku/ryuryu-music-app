import { describe, expect, it } from "vitest";
import { findNearbyDuplicate, splitArtists } from "./duplicates";

const rows = [
  { rowNum: 2886, date: "2026/11/06", title: "Hisaishi: Symphonic Suite The Boy and The Heron For Piano and Orchestra", artist: "久石譲 & Royal Philharmonic Orchestra" },
  { rowNum: 2899, date: "2026/11/06", title: "Old Flames", artist: "La Roux" },
  { rowNum: 2923, date: "2026/11/06", title: "Sure", artist: "Monsune" },
  { rowNum: 2700, date: "2026/10/02", title: "Telepathy", artist: "Someone" },
];

describe("取り込み元をまたいだ重複", () => {
  it("名義を分けたどれかが一致すれば同じ作品", () => {
    expect(findNearbyDuplicate(rows, {
      date: "2026-11-06", title: "Symphonic Suite The Boy and the Heron for piano and orchestra",
      artistNames: ["Joe Hisaishi", "Royal Philharmonic Orchestra"],
    })).toBe(2886);
  });

  it("作品名の一方がもう一方を含めば同じ作品（名義の表記が違っても）", () => {
    expect(findNearbyDuplicate(rows, { date: "2026-11-05", title: "Old Flames (Deluxe)", artistNames: ["LA ROUX feat. X"] })).toBe(2899);
    expect(findNearbyDuplicate(rows, { date: "2026-11-06", title: "[EP] Old Flames", artistNames: ["ラルー"] })).toBe(2899);
  });

  it("短い作品名・7日より離れた行では一致させない", () => {
    expect(findNearbyDuplicate(rows, { date: "2026-11-06", title: "Sure Thing", artistNames: ["Other"] })).toBeNull();
    expect(findNearbyDuplicate(rows, { date: "2026-11-06", title: "Telepathy", artistNames: ["Someone"] })).toBeNull();
  });

  it("バンド名の and / x / スラッシュでは分けない", () => {
    expect(splitArtists("Christine and the Queens")).toEqual(["christine and the queens"]);
    expect(splitArtists("AC/DC")).toEqual(["ac/dc"]);
    expect(splitArtists("Curren$y & Harry Fraud")).toEqual(["curren$y", "harry fraud"]);
    expect(splitArtists("Ado feat. 初音ミク")).toEqual(["ado", "初音ミク"]);
  });
});
