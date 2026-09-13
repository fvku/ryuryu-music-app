import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetchGeneratorImage: vi.fn(), readGeneratorReleaseMaster: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/generator/remote-image", () => ({ fetchGeneratorImage: mocks.fetchGeneratorImage }));
vi.mock("@/lib/generator/release-master", () => ({ readGeneratorReleaseMaster: mocks.readGeneratorReleaseMaster }));
import { GET, POST } from "@/app/api/generator/documents/route";
import { GET as read, PATCH } from "@/app/api/generator/documents/[id]/route";
import { POST as lock } from "@/app/api/generator/documents/[id]/locks/route";
import { GET as history } from "@/app/api/generator/documents/[id]/revisions/route";
import { POST as uploadAsset } from "@/app/api/generator/documents/[id]/assets/route";
import { GET as readAsset } from "@/app/api/generator/documents/[id]/assets/[assetId]/route";
import { GET as source } from "@/app/api/generator/source/route";
import { GET as remoteImage } from "@/app/api/generator/remote-image/route";
import { GET as reimportDiff } from "@/app/api/generator/documents/[id]/reimport/route";

const email = "kohei.fuku0926@gmail.com";
const validSession = { user: { email }, loginProvider: "google", googleVerifiedEmail: email };
const request = (method = "GET", body?: unknown, origin = "https://app.example") => new Request("https://app.example/api/generator/documents", {
  method, headers: { origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const context = () => ({ params: Promise.resolve({ id: randomUUID() }) });
const assetContext = () => ({ params: Promise.resolve({ id: randomUUID(), assetId: randomUUID() }) });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mocks.auth.mockReset(); mocks.auth.mockResolvedValue(validSession);
  mocks.fetchGeneratorImage.mockReset();
  mocks.readGeneratorReleaseMaster.mockReset(); mocks.readGeneratorReleaseMaster.mockResolvedValue([]);
  fetchMock = vi.fn().mockImplementation(async () => Response.json({ version: 1 })); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ALLOWED_MEMBER_EMAILS", ""); vi.stubEnv("GENERATOR_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://preview-test.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("authenticated generator routes", () => {
  it.each([
    [null, 401, "UNAUTHENTICATED"],
    [{ user: { email } }, 401, "GOOGLE_REAUTH_REQUIRED"],
    [{ ...validSession, loginProvider: "spotify" }, 401, "GOOGLE_REAUTH_REQUIRED"],
    [{ ...validSession, user: { email: "revoked@example.com" } }, 403, "FORBIDDEN"],
  ])("rejects invalid sessions on every route without contacting storage", async (session, status, code) => {
    mocks.auth.mockResolvedValue(session);
    const results = await Promise.all([GET(request()), POST(request("POST", {})), read(request(), context()), PATCH(request("PATCH", {}), context()), lock(request("POST", {}), context()), history(request(), context()), readAsset(request(), assetContext()), uploadAsset(request("POST", {}), context()), source(new Request("https://app.example/api/generator/source?series=monthly&month=2026-08")), remoteImage(new Request("https://app.example/api/generator/remote-image?url=https%3A%2F%2Fimages.example%2Fcover.jpg"))]);
    for (const result of results) {
      expect(result.status).toBe(status); expect(await result.json()).toHaveProperty("code", code);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rechecks an allowlist change rather than trusting an old valid session", async () => {
    vi.stubEnv("ALLOWED_MEMBER_EMAILS", "another@example.com");
    expect((await GET(request())).status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns a real 503 when disabled or unconfigured, never an in-memory save success", async () => {
    vi.stubEnv("GENERATOR_ENABLED", "false");
    const result = await POST(request("POST", { document: fixture(), requestId: randomUUID() }));
    expect(result.status).toBe(503); expect(await result.json()).toHaveProperty("code", "GENERATOR_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("blocks cross-origin JSON writes before validation or storage", async () => {
    expect((await POST(request("POST", {}, "https://other.example"))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("creates a validated snapshot with server identity and a retry ID", async () => {
    const doc = fixture(), requestId = randomUUID();
    const result = await POST(request("POST", { document: doc, requestId }));
    expect(result.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://preview-test.supabase.co/rest/v1/rpc/generator_create");
    expect(JSON.parse(init.body)).toMatchObject({ p_actor: email, p_request_id: requestId, p_document: doc });
    expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
    expect(init.headers.apikey).toBe("sb_secret_test_only"); expect(init.headers.Authorization).toBeUndefined();
    const response = await result.json();
    expect(response.locks).toEqual([]); expect(JSON.stringify(response)).not.toContain("sb_secret");
  });
  it("accepts legacy service role credentials only server-side", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-test-only");
    await GET(request()); expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer legacy-test-only");
  });
  it("does not send credentials to arbitrary configured destinations or redirects", async () => {
    for (const url of ["https://evil.invalid", "http://test.supabase.co", "https://test.supabase.co@evil.invalid", "https://test.supabase.co/path"]) {
      vi.stubEnv("SUPABASE_URL", url); expect((await GET(request())).status).toBe(503);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends only hashed lock secrets and target content, never client actor or full-document replacement", async () => {
    const doc = fixture(); const source = { ...doc.items[0].source, kind: "release-master" as const, uid: "rm-source",
      importedAt: "2026-09-12T00:00:00.000Z", coverUrl: "https://example.com/new-cover.jpg" };
    const command = { requestId: randomUUID(), kind: "item", targetId: doc.items[0].id,
      clientId: randomUUID(), token: "a".repeat(64), generation: 1, expectedVersion: 1, content: doc.items[0].content, source };
    const result = await PATCH(request("PATCH", command), { params: Promise.resolve({ id: doc.id }) });
    expect(result.status).toBe(200);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generator_item_save");
    expect(body.p_actor).toBe(email); expect(body.p_change.tokenHash).toHaveLength(64);
    expect(body.p_change.source).toEqual(source);
    expect(JSON.stringify(body)).not.toContain(command.token);
    const contentOnly = { ...command, requestId: randomUUID(), source: undefined };
    expect((await PATCH(request("PATCH", contentOnly), { params: Promise.resolve({ id: doc.id }) })).status).toBe(200);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("generator_save");
    const restore = { requestId: randomUUID(), kind: "item", targetId: doc.items[0].id,
      clientId: command.clientId, token: command.token, generation: 1, expectedVersion: 2, restoreVersion: 1 };
    expect((await PATCH(request("PATCH", restore), { params: Promise.resolve({ id: doc.id }) })).status).toBe(200);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("generator_item_save");
    expect((await PATCH(request("PATCH", { ...command, actor: "spoofed" }), context())).status).toBe(400);
    expect((await PATCH(request("PATCH", { document: doc }), context())).status).toBe(400);
  });
  it("returns safe conflict codes but never leaks backend errors or credentials", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: "P0001", message: "VERSION_CONFLICT" }, { status: 400 }));
    const conflict = await GET(request()); expect(conflict.status).toBe(409); expect(await conflict.json()).toHaveProperty("code", "VERSION_CONFLICT");
    fetchMock.mockResolvedValueOnce(Response.json({ message: "secret SQL credentials should not appear", hint: "sb_secret_leak" }, { status: 500 }));
    const error = await GET(request()); expect(error.status).toBe(503); expect(await error.text()).not.toContain("secret");
    fetchMock.mockRejectedValueOnce(new Error("token-leak"));
    const network = await GET(request()); expect(network.status).toBe(503); expect(await network.text()).not.toContain("token-leak");
  });
  it("handles async route params, limits history requests, and exposes no CORS wildcard", async () => {
    const response = await read(request(), context()); expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await history(new Request("https://app.example/api?before=0"), context())).status).toBe(400);
    expect((await history(new Request("https://app.example/api?before=3"), context())).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toHaveProperty("p_before", 3);
  });
  it("reads a reimport diff without acquiring a structure lock", async () => {
    const document = fixture();
    fetchMock.mockResolvedValueOnce(Response.json({
      document, version: 1, themeVersion: 1, structureVersion: 1,
      pageVersions: Object.fromEntries(document.pages.map(page => [page.id, 1])),
      itemVersions: Object.fromEntries(document.items.map(item => [item.id, 1])),
      updatedAt: "2026-09-13T00:00:00.000Z", updatedBy: email, locks: [],
    }));
    const result = await reimportDiff(
      new Request(`https://app.example/api/generator/documents/${document.id}/reimport`),
      { params: Promise.resolve({ id: document.id }) },
    );
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/rpc/generator_read");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("generator_lock");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("generator_reimport");
  });
  it("validates, registers and uploads an image without exposing its lock token", async () => {
    const id = randomUUID(), assetId = randomUUID(), itemId = randomUUID(), clientId = randomUUID();
    const bytes = new Uint8Array(24), view = new DataView(bytes.buffer); bytes.set([137,80,78,71,13,10,26,10], 0); bytes.set([73,72,68,82], 12); view.setUint32(16, 10); view.setUint32(20, 20);
    const form = new FormData(); form.set("file", new File([bytes], "cover.png", { type: "image/png" })); form.set("assetId", assetId); form.set("kind", "item"); form.set("targetId", itemId); form.set("clientId", clientId); form.set("token", "a".repeat(64)); form.set("generation", "1");
    fetchMock.mockResolvedValueOnce(Response.json({ path: `${id}/${assetId}.png` })).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ id: assetId, mimeType: "image/png", width: 10, height: 20 }));
    const result = await uploadAsset(new Request(`https://app.example/api/generator/documents/${id}/assets`, { method: "POST", headers: { origin: "https://app.example" }, body: form }), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(201); expect(await result.json()).toHaveProperty("id", assetId);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generator_asset_prepare"); expect(String(fetchMock.mock.calls[1][0])).toContain(`/storage/v1/object/generator-assets/${id}/${assetId}.png`);
    expect(String(fetchMock.mock.calls[2][0])).toContain("generator_asset_ready");
    expect(JSON.stringify(fetchMock.mock.calls.map(call => call[1]?.body))).not.toContain("a".repeat(64));
  });
  it("fetches a URL on the server and stores the original validated bytes under the existing item lock", async () => {
    const id = randomUUID(), assetId = randomUUID(), itemId = randomUUID(), clientId = randomUUID();
    const bytes = new Uint8Array(24), view = new DataView(bytes.buffer); bytes.set([137,80,78,71,13,10,26,10], 0); bytes.set([73,72,68,82], 12); view.setUint32(16, 10); view.setUint32(20, 20);
    mocks.fetchGeneratorImage.mockResolvedValue({ bytes, mimeType: "image/png", width: 10, height: 20 });
    fetchMock.mockResolvedValueOnce(Response.json({ path: `${id}/${assetId}.png` })).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ id: assetId }));
    const body = { url: "https://f4.bcbits.com/img/cover.jpg", assetId, kind: "item", targetId: itemId, clientId, token: "b".repeat(64), generation: 2 };
    const result = await uploadAsset(new Request(`https://app.example/api/generator/documents/${id}/assets`, {
      method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(201);
    expect(mocks.fetchGeneratorImage).toHaveBeenCalledWith(body.url);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/storage/v1/object/generator-assets/${id}/${assetId}.png`);
    expect(new Uint8Array(fetchMock.mock.calls[1][1].body)).toEqual(bytes);
    expect(JSON.stringify(fetchMock.mock.calls.map(call => call[1]?.body))).not.toContain("b".repeat(64));
  });
  it("rejects URL uploads for non-item targets before making an external request", async () => {
    const id = randomUUID();
    const body = { url: "https://images.example/theme.png", assetId: randomUUID(), kind: "theme", targetId: id, clientId: randomUUID(), token: "c".repeat(64), generation: 1 };
    const result = await uploadAsset(new Request(`https://app.example/api/generator/documents/${id}/assets`, {
      method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(400);
    expect(await result.json()).toHaveProperty("code", "INVALID_INPUT");
    expect(mocks.fetchGeneratorImage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("serves a validated remote image through an authenticated same-origin response", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.fetchGeneratorImage.mockResolvedValue({ bytes, mimeType: "image/webp", width: 10, height: 10 });
    const url = "https://images.example/cover.webp";
    const result = await remoteImage(new Request(`https://app.example/api/generator/remote-image?url=${encodeURIComponent(url)}`, { headers: { "sec-fetch-site": "same-origin" } }));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("image/webp");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(mocks.fetchGeneratorImage).toHaveBeenCalledWith(url);

    mocks.fetchGeneratorImage.mockClear();
    const blocked = await remoteImage(new Request(`https://app.example/api/generator/remote-image?url=${encodeURIComponent(url)}`, { headers: { "sec-fetch-site": "cross-site" } }));
    expect(blocked.status).toBe(403);
    expect(mocks.fetchGeneratorImage).not.toHaveBeenCalled();
  });
  it("authorizes private image reads and checks stored byte length", async () => {
    const id = randomUUID(), assetId = randomUUID(), bytes = new Uint8Array([1,2,3]);
    fetchMock.mockResolvedValueOnce(Response.json({ path: `${id}/${assetId}.png`, mimeType: "image/png", bytes: 3 })).mockResolvedValueOnce(new Response(bytes));
    const result = await readAsset(request(), { params: Promise.resolve({ id, assetId }) });
    expect(result.status).toBe(200); expect(result.headers.get("content-type")).toBe("image/png"); expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
  });
});
