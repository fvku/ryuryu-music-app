import { describe, expect, it } from "vitest";
import { releaseMasterCover } from "../cover-source";

describe("releaseMasterCover", () => {
  it("uses the 画像リンク変換 column first", () => {
    expect(releaseMasterCover({ coverUrlLarge: "https://a.example/large.jpg", coverUrl: "https://b.example/small.jpg" }))
      .toBe("https://a.example/large.jpg");
  });

  it("takes that column whatever the host is, not only Apple Music", () => {
    expect(releaseMasterCover({ coverUrlLarge: "https://images.bandcamp.test/cover.jpg", coverUrl: "" }))
      .toBe("https://images.bandcamp.test/cover.jpg");
  });

  it("falls back to the Spotify column when the first one is blank", () => {
    expect(releaseMasterCover({ coverUrlLarge: "   ", coverUrl: "https://b.example/small.jpg" }))
      .toBe("https://b.example/small.jpg");
  });

  it("returns null when the row has neither", () => {
    expect(releaseMasterCover({ coverUrlLarge: "", coverUrl: "  " })).toBeNull();
  });
});
