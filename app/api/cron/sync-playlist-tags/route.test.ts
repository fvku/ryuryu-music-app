import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), log: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/ops/sync-playlist-tags", () => ({ syncPlaylistTags: mocks.sync }));
vi.mock("@/lib/admin-auth", () => ({ logCronResult: mocks.log }));
vi.mock("@/lib/api-cache", () => ({ invalidateCache: mocks.invalidate, CACHE_KEY: { RELEASE_MASTER: "release-master" } }));
import { GET } from "./route";

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "fixture-secret"); });
afterEach(() => vi.unstubAllEnvs());

it.each([{ failed: [] }, { failed: [{ label: "fixture", playlistId: "fixture", error: "fixture failure" }] }])(
  "records a partial playlist failure as failed without discarding completed work (%j)",
  async ({ failed }) => {
    mocks.sync.mockResolvedValue({ month: "2026-11", written: 2, index: { failed, fetched: [] } });
    const request = new NextRequest("https://app.example/api/cron/sync-playlist-tags", { headers: { authorization: "Bearer fixture-secret" } });
    expect((await GET(request)).status).toBe(200);
    expect(mocks.log).toHaveBeenCalledWith("sync-playlist-tags", failed.length === 0, expect.objectContaining({ written: 2, failed }));
    expect(mocks.invalidate).toHaveBeenCalledWith("release-master");
  },
);
