import { describe, expect, it, vi } from "vitest";
import { cached, invalidateCache } from "./api-cache";

describe("api-cache", () => {
  it("読み取りの途中で無効化されたら、古い結果を保存し直さない", async () => {
    let resolve!: (v: string) => void;
    const p = cached("t1", 60_000, () => new Promise<string>((r) => { resolve = r; }));
    invalidateCache("t1");
    resolve("古い内容");
    await p;
    const refetch = vi.fn(async () => "新しい内容");
    expect(await cached("t1", 60_000, refetch)).toBe("新しい内容");
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("無効化の後に始まった読み取りは、それ以前の読み取りに合流しない", async () => {
    let resolveOld!: (v: string) => void;
    const old = cached("t2", 60_000, () => new Promise<string>((r) => { resolveOld = r; }));
    invalidateCache("t2");
    const fresh = cached("t2", 60_000, async () => "新しい内容");
    resolveOld("古い内容");
    expect(await old).toBe("古い内容");
    expect(await fresh).toBe("新しい内容");
    expect(await cached("t2", 60_000, async () => "使われない")).toBe("新しい内容");
  });

  it("同じ世代の並行リクエストは1回の取得にまとめる", async () => {
    const fetcher = vi.fn(async () => 1);
    await Promise.all([cached("t3", 60_000, fetcher), cached("t3", 60_000, fetcher)]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
