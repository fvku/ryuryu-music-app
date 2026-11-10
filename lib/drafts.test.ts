import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, DRAFT_MAX_AGE_MS, draftKey, loadDraft, saveDraft } from "./drafts";
import { resolveSavedTrack } from "@/hooks/useMjTracks";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

beforeEach(() => { vi.stubGlobal("window", { localStorage: memoryStorage() }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("drafts", () => {
  it("UID優先でアルバムを識別し、レビューは本人ごとに分ける", () => {
    expect(draftKey("mj", { uid: "abcd1234", no: "12" })).toBe("ryuryu_draft:mj:abcd1234");
    expect(draftKey("mj", { uid: "", no: "12" })).toBe("ryuryu_draft:mj:no-12");
    expect(draftKey("review", { uid: "abcd1234", no: "12" }, "A@x.com")).toBe("ryuryu_draft:review:abcd1234:a@x.com");
  });

  it("保存・読み込み・削除ができる", () => {
    const key = draftKey("mj", { uid: "abcd1234", no: "12" });
    saveDraft(key, { text: "書きかけ" }, 1000);
    expect(loadDraft<{ text: string }>(key, 2000)).toEqual({ savedAt: 1000, value: { text: "書きかけ" } });
    clearDraft(key);
    expect(loadDraft(key, 2000)).toBeNull();
  });

  it("古すぎる下書きは提案せずに消す", () => {
    const key = "ryuryu_draft:mj:old";
    saveDraft(key, { text: "前の作業" }, 0);
    expect(loadDraft(key, DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(loadDraft(key, 1)).toBeNull();
  });

  it("壊れた値やlocalStorageが使えない環境でも落ちない", () => {
    window.localStorage.setItem("ryuryu_draft:mj:broken", "{");
    expect(loadDraft("ryuryu_draft:mj:broken")).toBeNull();
    vi.stubGlobal("window", { get localStorage(): Storage { throw new Error("blocked"); } });
    expect(() => saveDraft("k", 1)).not.toThrow();
    expect(loadDraft("k")).toBeNull();
  });
});

describe("resolveSavedTrack", () => {
  const tracks = [
    { trackNumber: 1, name: "Intro", durationMs: 1, uri: "u1" },
    { trackNumber: 2, name: "Song", durationMs: 1, uri: "u2" },
  ];
  it("曲名一致を番号より優先する", () => {
    expect(resolveSavedTrack(tracks, "1", "Song")?.uri).toBe("u2");
  });
  it("曲一覧が無い（読み込み中・失敗）ときは null で、選択を外したことにはならない", () => {
    expect(resolveSavedTrack([], "2", "Song")).toBeNull();
  });
});
