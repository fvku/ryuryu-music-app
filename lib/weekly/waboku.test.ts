import { describe, expect, it } from "vitest";
import { classifyWaboku, titleAndExclusion } from "./waboku";

const base = { artistNames: ["X"], title: "T", genres: [] as string[], label: "", history: null };

describe("洋邦の判定（New Music Friday Japan）", () => {
  it("過去の登録があればそれを使う", () => {
    expect(classifyWaboku({ ...base, artistNames: ["XG"], genres: ["k-pop"], history: "邦楽" }).waboku).toBe("邦楽");
    expect(classifyWaboku({ ...base, artistNames: ["ヨルシカ"], history: "洋楽" }).waboku).toBe("洋楽");
  });

  it("かなの表記・日本のジャンル・日本のレーベルは邦楽", () => {
    expect(classifyWaboku({ ...base, artistNames: ["Ado"], title: "シンカ" }).waboku).toBe("邦楽");
    expect(classifyWaboku({ ...base, artistNames: ["luv"], genres: ["japanese indie", "j-r&b"] }).reason).toBe("ジャンル：japanese indie");
    expect(classifyWaboku({ ...base, artistNames: ["Lilas"], genres: ["j-pop", "anime"], label: "Walt Disney Records" }).waboku).toBe("邦楽");
    expect(classifyWaboku({ ...base, label: "Sony Music Labels Inc." }).waboku).toBe("邦楽");
    expect(classifyWaboku({ ...base, label: "WM Japan" }).waboku).toBe("邦楽");
    expect(classifyWaboku({ ...base, artistNames: ["米津玄師"] }).waboku).toBe("邦楽");
    expect(classifyWaboku({ ...base, artistNames: ["CHAMELEON LIME WHOOPIEPIE", "ネコニスズ"] }).waboku).toBe("邦楽");
  });

  it("手がかりが無ければ洋楽。作品名の漢字（客演の中国語名など）では邦楽にしない", () => {
    expect(classifyWaboku({ ...base, artistNames: ["Rex Orange County"], genres: ["bedroom pop"] }).waboku).toBe("洋楽");
    expect(classifyWaboku({ ...base, artistNames: ["The Weeknd"], title: "Hong Kong (feat. 王菲)", label: "XO / Republic Records" }).waboku).toBe("洋楽");
    expect(classifyWaboku({ ...base, artistNames: ["Kings of Leon"], label: "Love Tap Records, LLC" }).waboku).toBe("洋楽");
    expect(classifyWaboku({ ...base, artistNames: ["Shygirl"], genres: ["hyperpop"], label: "Because Music Ltd." }).waboku).toBe("洋楽");
  });
});

describe("洋邦ごとの作品名と除外", () => {
  it("邦楽のEPは [EP] を付けて候補、洋楽のEPは対象外", () => {
    expect(titleAndExclusion("hello", "EP", null, "邦楽")).toEqual({ title: "[EP] hello", excludeReason: null });
    expect(titleAndExclusion("hello", "EP", null, "洋楽")).toEqual({ title: "hello", excludeReason: "洋楽のEP" });
  });

  it("アルバムは洋邦どちらも候補。もともとの除外理由は保つ", () => {
    expect(titleAndExclusion("A", "アルバム", null, "洋楽")).toEqual({ title: "A", excludeReason: null });
    expect(titleAndExclusion("A (Deluxe)", "アルバム", "デラックス版", "邦楽").excludeReason).toBe("デラックス版");
    expect(titleAndExclusion("s", "シングル", "シングル", "洋楽").excludeReason).toBe("シングル");
  });
});
