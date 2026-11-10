import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), io: vi.fn(), scores: vi.fn(), recs: vi.fn(), bookmarks: vi.fn(), addBookmark: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/google-auth", () => ({ getGoogleAuth: () => ({}) }));
vi.mock("googleapis", () => ({ google: { sheets: () => ({ spreadsheets: { values: { get: mocks.io, update: mocks.io, batchUpdate: mocks.io, batchClear: mocks.io } } }) } }));
vi.mock("@/lib/sheets", () => ({
  getAllScores: mocks.scores, getScoresForAlbum: mocks.scores,
  getAllRecommendations: mocks.recs, getRecommendationsForUser: mocks.recs,
  getBookmarks: mocks.bookmarks, addBookmark: mocks.addBookmark, removeBookmark: mocks.io,
  getAllNotificationSeen: vi.fn(async () => ({})), setForYouSeenAt: mocks.io,
  addScore: mocks.io, updateScore: mocks.io, hasScore: mocks.io, initScoresSheet: mocks.io,
  addRecommendation: mocks.io, initRecommendationsSheet: mocks.io,
}));
vi.mock("@/lib/release-master", () => ({ getWriteAuth: () => ({}), getReleaseMasterScoreRows: vi.fn(async () => []), writeScoreToReleaseMaster: mocks.io, writeSpotifyDataToSheet: mocks.io }));
vi.mock("@/lib/spotify", () => ({ searchAlbums: mocks.io }));
vi.mock("@/lib/ops/assign-uids", () => ({ assignUids: vi.fn(async () => ({ assigned: 0 })) }));
vi.mock("@/lib/ops/backfill-album-uids", () => ({ backfillAlbumUids: vi.fn(async () => ({ sheets: [] })) }));
import { guardMember } from "./member-auth";
import { isAuthorized } from "./api-token";
import { invalidateCache, CACHE_KEY } from "./api-cache";
import * as scores from "@/app/api/scores/route";
import * as albumScores from "@/app/api/scores/[albumNo]/route";
import * as recs from "@/app/api/recommendations/route";
import * as bookmarks from "@/app/api/bookmarks/route";
import * as seen from "@/app/api/notifications/seen/route";
import * as master from "@/app/api/release-master/route";
import * as album from "@/app/api/release-master/[no]/route";
import * as headers from "@/app/api/release-master/headers/route";
import * as check from "@/app/api/sheets/check-album/route";
import * as add from "@/app/api/sheets/add-album/route";
import * as search from "@/app/api/spotify/search/route";
import * as spotifyAlbum from "@/app/api/spotify/album/route";
import * as tracks from "@/app/api/spotify/tracks/route";
import * as covers from "@/app/api/spotify/covers/route";
import * as oauth from "@/app/api/spotify-oauth/route";
import * as refresh from "@/app/api/spotify-oauth/refresh/route";
import * as sync from "@/app/api/cron/sync-release-master/route";
import * as settings from "@/app/api/admin/settings/route";

const email = "kohei.fuku0926@gmail.com";
const session = { user: { email }, loginProvider: "google", googleVerifiedEmail: email };
function req(path: string, method = "GET", origin = "https://app.example", body: unknown = {}) {
  return new NextRequest(`https://app.example/api/${path}`, {
    method, headers: { origin, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
const writes = () => [
  () => albumScores.POST(req("scores/1", "POST"), { params: Promise.resolve({ albumNo: "1" }) }),
  () => albumScores.PUT(req("scores/1", "PUT")),
  () => recs.POST(req("recommendations", "POST")),
  () => bookmarks.POST(req("bookmarks", "POST")),
  () => bookmarks.DELETE(req("bookmarks", "DELETE")),
  () => seen.POST(req("notifications/seen", "POST")),
  () => album.PATCH(req("release-master/1", "PATCH")),
  () => add.POST(req("sheets/add-album", "POST")),
  () => covers.POST(req("spotify/covers", "POST")),
  () => sync.POST(req("cron/sync-release-master", "POST")),
];
const reads = () => [
  () => scores.GET(), () => albumScores.GET(req("scores/1?title=A&artist=B")),
  () => recs.GET(req("recommendations")), () => recs.GET(req("recommendations?forUser=me")),
  () => bookmarks.GET(req("bookmarks")), () => seen.GET(req("notifications/seen")),
  () => master.GET(req("release-master")), () => album.GET(req("release-master/1?uid=a")),
  () => headers.GET(), () => check.GET(req("sheets/check-album?spotifyId=test")),
  () => search.GET(req("spotify/search?q=test")), () => spotifyAlbum.GET(req("spotify/album?id=test")),
  () => tracks.GET(req("spotify/tracks?spotifyUrl=test")), () => oauth.GET(),
  () => refresh.GET(req("spotify-oauth/refresh")), () => settings.GET(),
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_MEMBER_EMAILS", ""); vi.stubEnv("RELEASE_MASTER_API_TOKEN", "");
  vi.stubEnv("GOOGLE_SPREADSHEET_ID", "test-app"); vi.stubEnv("RELEASE_MASTER_SPREADSHEET_ID", "test-rm");
  vi.stubEnv("CRON_SECRET", "test-cron");
  mocks.auth.mockResolvedValue(session); mocks.io.mockResolvedValue({ data: { values: [] } });
  mocks.scores.mockResolvedValue([]); mocks.recs.mockResolvedValue([]); mocks.bookmarks.mockResolvedValue([]);
  vi.stubGlobal("fetch", mocks.io);
  invalidateCache(...Object.values(CACHE_KEY));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("member API authorization", () => {
  it.each([
    [null, 401], [{ user: { email } }, 401], [{ ...session, loginProvider: "spotify" }, 401],
    [{ ...session, googleVerifiedEmail: "different@example.com" }, 401],
    [{ ...session, user: { email: "outside@example.com" } }, 403],
  ])("blocks invalid sessions before reading or writing data (%j)", async (value, status) => {
    mocks.auth.mockResolvedValue(value);
    const gate = await guardMember();
    expect(!gate.ok && gate.response.status).toBe(status);
    // 外部トークン対応のRMは認証失敗を401へまとめる。それ以外も必ず拒否する。
    for (const call of [...reads(), ...writes()]) expect([401, 403]).toContain((await call()).status);
    expect(mocks.io).not.toHaveBeenCalled(); expect(mocks.scores).not.toHaveBeenCalled();
    expect(mocks.recs).not.toHaveBeenCalled(); expect(mocks.bookmarks).not.toHaveBeenCalled();
    expect(mocks.addBookmark).not.toHaveBeenCalled();
  });
  it("rechecks the current allowlist even for an existing valid JWT", async () => {
    vi.stubEnv("ALLOWED_MEMBER_EMAILS", "other@example.com");
    const gate = await guardMember(); expect(gate.ok).toBe(false);
    expect((await scores.GET()).status).toBe(403); expect(mocks.scores).not.toHaveBeenCalled();
  });
  it("allows member reads and scopes personal results to the verified identity", async () => {
    expect((await scores.GET()).status).toBe(200);
    expect((await recs.GET(req("recommendations?forUser=me"))).status).toBe(200);
    expect((await bookmarks.GET(req("bookmarks"))).status).toBe(200);
    expect(mocks.recs).toHaveBeenCalledWith(email); expect(mocks.bookmarks).toHaveBeenCalledWith(email);
    expect((await bookmarks.POST(req("bookmarks", "POST", "https://app.example", { albumTitle: "A", artistName: "B", albumUid: "uid", memberName: "spoof@example.com" }))).status).toBe(201);
    expect(mocks.addBookmark).toHaveBeenCalledWith(email, "A", "B", "uid");
  });
  it.each([undefined, "null", "https://evil.example"])("rejects writes from missing or foreign origins (%s)", async origin => {
    const request = new NextRequest("https://app.example/api/bookmarks", { method: "POST", headers: origin ? { origin } : {}, body: "{}" });
    expect((await bookmarks.POST(request)).status).toBe(403);
    expect(mocks.addBookmark).not.toHaveBeenCalled();
  });
  it("rejects a contradictory cross-site browser header", async () => {
    const request = new NextRequest("https://app.example/api/bookmarks", { method: "POST", headers: { origin: "https://app.example", "sec-fetch-site": "cross-site" }, body: "{}" });
    expect((await bookmarks.POST(request)).status).toBe(403);
  });
  it("preserves bearer-token reads for external Release Master tools, independently of session login", async () => {
    mocks.auth.mockResolvedValue(null); vi.stubEnv("RELEASE_MASTER_API_TOKEN", "read-token");
    const request = new NextRequest("https://app.example/api/release-master", { headers: { authorization: "Bearer read-token" } });
    expect(await isAuthorized(request)).toBe(true); expect((await master.GET(request)).status).toBe(200);
    expect((await master.GET(req("release-master"))).status).toBe(401);
  });
  it("requires the Cron secret on GET and still allows authorized browser POST sync", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await sync.GET(req("cron/sync-release-master"))).status).toBe(401);
    expect(mocks.io).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue(session);
    expect((await sync.POST(req("cron/sync-release-master", "POST"))).status).toBe(200);
    const cronRequest = new NextRequest("https://app.example/api/cron/sync-release-master", { headers: { authorization: "Bearer test-cron" } });
    expect((await sync.GET(cronRequest)).status).toBe(200);
  });
});
