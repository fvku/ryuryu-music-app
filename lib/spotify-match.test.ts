import { describe, expect, it } from "vitest";
import { artistMatch, titleMatch } from "./spotify-match";

describe("spotify-match", () => {
  it("同じアルバムは一致とみなす", () => {
    expect(titleMatch("Ow ∞", "Ow ∞")).toBe(true);
    expect(artistMatch("Sylvan Esso", "Sylvan Esso")).toBe(true);
    expect(titleMatch("[EP] Foo", "Foo")).toBe(true);
    expect(artistMatch("Blu & Sndtrak", "Blu, Sndtrak")).toBe(true);
  });

  it("検索1件目が別アーティストの別作品なら不一致（2026-09-18 に誤カバーが出ていた例）", () => {
    expect(titleMatch("status update music", "Status Update") && artistMatch("leroy", "nihmune")).toBe(false);
    expect(titleMatch("ひろった石が割れた (Hirotta ishiga wareta)", "分かっちゃいないね (feat.花隈千冬)")).toBe(false);
  });
});
