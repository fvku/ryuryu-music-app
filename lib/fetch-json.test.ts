import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonOrThrow, LoadError } from "./fetch-json";

afterEach(() => vi.unstubAllGlobals());

describe("fetchJsonOrThrow", () => {
  it("成功時はJSONを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([1])));
    await expect(fetchJsonOrThrow<number[]>("/x")).resolves.toEqual([1]);
  });

  it("認証切れを空の一覧ではなく再ログインの案内として投げる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const err = (await fetchJsonOrThrow("/x").catch((e) => e)) as LoadError;
    expect(err).toBeInstanceOf(LoadError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("ログイン");
  });

  it("通信例外も原因が分かる文言にする", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = (await fetchJsonOrThrow("/x").catch((e) => e)) as LoadError;
    expect(err.status).toBeNull();
    expect(err.message).toContain("通信");
  });
});
