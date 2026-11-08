import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
import { POST } from "@/app/api/generator/documents/[id]/audio/route";
import { GET } from "@/app/api/generator/documents/[id]/audio/[audioId]/route";
import { purgeExpiredAudio } from "../audio";

const email = "kohei.fuku0926@gmail.com";
const documentId = randomUUID(), audioId = randomUUID(), itemId = randomUUID();
const objectKey = `audio/${documentId}/${audioId}.mp3`;
const lock = { kind: "item", targetId: itemId, clientId: randomUUID(), token: "a".repeat(64), generation: 1 };
const post = (body: unknown) => POST(new Request("https://app.example/api", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: documentId }) });
const body = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 1, 2, 3]);
const sha256 = createHash("sha256").update(body).digest("hex");
let rpc: ReturnType<typeof vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>>;
let b2: ReturnType<typeof vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ user: { email }, loginProvider: "google", googleVerifiedEmail: email });
  vi.stubEnv("ALLOWED_MEMBER_EMAILS", ""); vi.stubEnv("GENERATOR_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://preview-test.supabase.co"); vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only");
  vi.stubEnv("B2_KEY_ID", "key"); vi.stubEnv("B2_APPLICATION_KEY", "secret");
  vi.stubEnv("B2_BUCKET", "ryuryu-generator-audio"); vi.stubEnv("B2_ENDPOINT", "s3.us-west-004.backblazeb2.com");
  rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>();
  b2 = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const value = new URL(String(url));
    if (value.hostname.endsWith("supabase.co")) {
      const name = value.pathname.split("/").pop()!;
      return Response.json(await rpc(name, JSON.parse(String(init?.body))));
    }
    return b2(value, init);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("音声のアップロードAPI", () => {
  it("prepares with the item lock and hands out a short-lived PUT URL for B2 only", async () => {
    rpc.mockResolvedValue({ id: audioId, objectKey, status: "pending" });
    const response = await post({ action: "prepare", audioId, itemId, mimeType: "audio/mpeg", bytes: 8, sha256, name: "dir/曲\u0000.mp3", ...lock });
    expect(response.status).toBe(200);
    const result = await response.json();
    const url = new URL(result.uploadUrl);
    expect(url.host).toBe("s3.us-west-004.backblazeb2.com");
    expect(url.pathname).toBe(`/ryuryu-generator-audio/${objectKey}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(result.headers).toEqual({ "Content-Type": "audio/mpeg" });
    const [name, args] = rpc.mock.calls[0] as [string, { p_actor: string; p_audio: unknown; p_lock: { tokenHash: string } }];
    expect(name).toBe("generator_audio_prepare");
    expect(args.p_actor).toBe(email);
    expect(args.p_audio).toEqual({ id: audioId, itemId, mimeType: "audio/mpeg", bytes: 8, sha256, name: "dir曲.mp3" });
    expect(args.p_lock.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("a".repeat(64));
  });
  it("refuses other formats, oversize files, and a missing B2 configuration before recording anything", async () => {
    const base = { action: "prepare", audioId, itemId, mimeType: "audio/mpeg", bytes: 8, sha256, name: "a.mp3", ...lock };
    expect((await post({ ...base, mimeType: "audio/wav" })).status).toBe(400);
    expect((await post({ ...base, bytes: 50 * 1024 * 1024 + 1 })).status).toBe(413);
    vi.stubEnv("B2_KEY_ID", "");
    const missing = await post(base);
    expect(missing.status).toBe(503);
    expect((await missing.json()).code).toBe("AUDIO_NOT_CONFIGURED");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("marks ready only after the uploaded bytes match, and removes a mismatching upload", async () => {
    const row = { id: audioId, itemId, objectKey, status: "pending", mimeType: "audio/mpeg", bytes: 8, sha256, name: "a.mp3", createdBy: email };
    rpc.mockImplementation(async (name: string) => name === "generator_audio_read" ? row : { id: audioId, itemId, name: "a.mp3", mimeType: "audio/mpeg", bytes: 8 });
    b2.mockImplementation(async () => new Response(body));
    const ok = await post({ action: "complete", audioId, ...lock });
    expect(ok.status).toBe(200);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["generator_audio_read", "generator_audio_ready"]);

    rpc.mockClear();
    const deleted: string[] = [];
    b2.mockImplementation(async (url: URL, init?: RequestInit) => {
      if (init?.method === "HEAD") return deleted.length ? new Response(null, { status: 404 }) : new Response(null, { headers: { "x-amz-version-id": "v1" } });
      if (init?.method === "DELETE") { deleted.push(url.searchParams.get("versionId")!); return new Response(null, { status: 204 }); }
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 9, 9, 9, 9, 9]));
    });
    const bad = await post({ action: "complete", audioId, ...lock });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("AUDIO_MISMATCH");
    expect(deleted).toEqual(["v1"]);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["generator_audio_read"]);
  });
  it("does not complete someone else's upload, nor one that has not arrived", async () => {
    rpc.mockResolvedValue({ id: audioId, itemId, objectKey, status: "pending", mimeType: "audio/mpeg", bytes: 8, sha256, name: "a.mp3", createdBy: "other@example.com" });
    expect((await post({ action: "complete", audioId, ...lock })).status).toBe(404);
    rpc.mockResolvedValue({ id: audioId, itemId, objectKey, status: "pending", mimeType: "audio/mpeg", bytes: 8, sha256, name: "a.mp3", createdBy: email });
    b2.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await post({ action: "complete", audioId, ...lock })).status).toBe(409);
  });
  it("serves a signed GET URL for ready audio only, and says when it has expired", async () => {
    const get = () => GET(new Request("https://app.example/api"), { params: Promise.resolve({ id: documentId, audioId }) });
    rpc.mockResolvedValue({ id: audioId, itemId, objectKey, status: "ready", mimeType: "audio/mpeg", bytes: 8, sha256, name: "a.mp3", createdBy: "other@example.com" });
    const ready = await (await get()).json();
    expect(new URL(ready.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(ready).toEqual(expect.objectContaining({ name: "a.mp3", bytes: 8, sha256 }));
    rpc.mockResolvedValue({ status: "deleted", objectKey });
    expect((await get()).status).toBe(410);
    rpc.mockResolvedValue({ status: "pending", objectKey });
    expect((await get()).status).toBe(404);
    mocks.auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
  it("purges expired audio from B2 and records only what was removed", async () => {
    const other = `audio/${documentId}/${randomUUID()}.m4a`;
    rpc.mockImplementation(async (name: string) => name === "generator_audio_expired"
      ? [{ documentId, id: audioId, objectKey }, { documentId, id: "x", objectKey: other }] : 1);
    b2.mockImplementation(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith(".m4a")) return new Response(null, { status: 500 });
      return init?.method === "HEAD" ? new Response(null, { status: 404 }) : new Response(null, { status: 204 });
    });
    expect(await purgeExpiredAudio()).toEqual({ deleted: 1, failed: 1 });
    expect(rpc.mock.calls[1]).toEqual(["generator_audio_forget", { p_items: [{ documentId, id: audioId }] }]);
    vi.stubEnv("B2_BUCKET", "");
    expect(await purgeExpiredAudio()).toEqual({ deleted: 0, failed: 0, skipped: "AUDIO_NOT_CONFIGURED" });
  });
});
