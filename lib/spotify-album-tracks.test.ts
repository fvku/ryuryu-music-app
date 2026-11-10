import { describe, expect, it, vi } from "vitest";
import { collectAllTrackItems, toAppTrack } from "./spotify-album-tracks";

describe("collectAllTrackItems", () => {
  it("next を最後まで辿り、複数枚組の曲を disc_number 付きで返す", async () => {
    const item = (disc: number, no: number) => ({ disc_number: disc, track_number: no, name: `d${disc}-${no}`, duration_ms: 1000, uri: `spotify:track:${disc}${no}` });
    const pages: Record<string, { items: ReturnType<typeof item>[]; next: string | null }> = {
      p2: { items: [item(2, 1)], next: "p3" },
      p3: { items: [item(2, 2)], next: null },
    };
    const fetchPage = vi.fn(async (url: string) => pages[url]);
    const items = await collectAllTrackItems({ items: [item(1, 1)], next: "p2" }, fetchPage);
    expect(items.map((t) => t.name)).toEqual(["d1-1", "d2-1", "d2-2"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(toAppTrack(items[1])).toEqual({ trackNumber: 1, discNumber: 2, name: "d2-1", durationMs: 1000, uri: "spotify:track:21" });
  });
});
