import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({
  user: { email: "kohei.fuku0926@gmail.com" }, loginProvider: "google", googleVerifiedEmail: "kohei.fuku0926@gmail.com",
})) }));
import { GET as authorize } from "@/app/api/spotify-oauth/route";
import { GET as callback } from "@/app/api/spotify-oauth/callback/route";

const stateCookie = "ryuryu_spotify_state";
const refreshCookie = "ryuryu_spotify_refresh";
const state = "a".repeat(43);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("SPOTIFY_CLIENT_ID", "test-client");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "test-secret");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("NEXTAUTH_URL", "https://app.example");
  fetchMock = vi.fn().mockResolvedValue(Response.json({
    access_token: "test-access", expires_in: 3600, refresh_token: "test-refresh",
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function request(query: Record<string, string>, cookie: string | null = state) {
  return new NextRequest(`https://app.example/api/spotify-oauth/callback?${new URLSearchParams(query)}`, {
    headers: cookie === null ? {} : { cookie: `${stateCookie}=${cookie}` },
  });
}

// Execute the one intended inline script in an isolated context; never run an injected second script.
async function messageFrom(response: Response) {
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  expect(scripts).toHaveLength(1);
  const postMessage = vi.fn(), close = vi.fn();
  runInNewContext(scripts[0][1], {
    window: { opener: { postMessage }, location: { origin: "https://app.example" }, close },
  });
  expect(close).toHaveBeenCalledOnce();
  expect(postMessage).toHaveBeenCalledOnce();
  expect(postMessage.mock.calls[0][1]).toBe("https://app.example");
  return { html, message: postMessage.mock.calls[0][0] };
}

describe("Spotify connection OAuth", () => {
  it("uses the canonical Auth.js URL for both authorization and token exchange", async () => {
    vi.stubEnv("AUTH_URL", "http://127.0.0.1:3000");
    const redirectUri = "http://127.0.0.1:3000/api/spotify-oauth/callback";
    const response = await authorize();
    expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri")).toBe(redirectUri);
    await callback(request({ state, code: "test-code" }));
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("redirect_uri")).toBe(redirectUri);
  });
  it("uses an explicit loopback IP for the local fallback permitted by Spotify", async () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    const response = await authorize();
    expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/spotify-oauth/callback");
  });
  it("binds each authorization redirect to a fresh, short-lived browser cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = await authorize(), second = await authorize();
    const url = new URL(first.headers.get("location")!);
    const issuedState = url.searchParams.get("state");
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/spotify-oauth/callback");
    expect(issuedState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.cookies.get(stateCookie)?.value).toBe(issuedState);
    expect(new URL(second.headers.get("location")!).searchParams.get("state")).not.toBe(issuedState);
    expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(first.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(first.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    expect(first.headers.get("set-cookie")).toMatch(/Max-Age=600/i);
    expect(first.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    [{ code: "test-code" }, state],
    [{ code: "test-code", state }, null],
    [{ code: "test-code", state: "b".repeat(43) }, state],
    [{ code: "test-code", state: "short" }, state],
    [{ error: "access_denied" }, state],
  ] as [Record<string, string>, string | null][])("rejects missing, expired, or mismatched state before token exchange (%j)", async (query, cookie) => {
    const response = await callback(request(query, cookie));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await messageFrom(response)).message).toEqual({ type: "SPOTIFY_AUTH_ERROR", error: "state_mismatch" });
    expect(response.cookies.get(refreshCookie)).toBeUndefined();
    expect(response.cookies.get(stateCookie)?.maxAge).toBe(0);
  });

  it("does not reflect a script-breaking error even when state is valid", async () => {
    const payload = "</script><script>globalThis.pwned=true</script>";
    const response = await callback(request({ state, error: payload }));
    const { html, message } = await messageFrom(response);
    expect(html).not.toContain(payload);
    expect(message).toEqual({ type: "SPOTIFY_AUTH_ERROR", error: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const nonce = html.match(/<script nonce="([^"]+)"/)?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
  });

  it("reports a normal denial or cancellation without exchanging a code", async () => {
    const queries: Record<string, string>[] = [{ state, error: "access_denied" }, { state }];
    for (const query of queries) {
      const response = await callback(request(query));
      expect((await messageFrom(response)).message).toEqual({ type: "SPOTIFY_AUTH_ERROR", error: "cancelled" });
      expect(response.cookies.get(stateCookie)?.maxAge).toBe(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the code, returns a safe popup message and stores only the refresh token in its cookie", async () => {
    const response = await callback(request({ state, code: "test-code" }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(new URLSearchParams(init.body).get("code")).toBe("test-code");
    expect(new URLSearchParams(init.body).get("redirect_uri")).toBe("https://app.example/api/spotify-oauth/callback");
    expect((await messageFrom(response)).message).toEqual({ type: "SPOTIFY_AUTH_SUCCESS", token: "test-access", expiresIn: 3600 });
    expect(response.cookies.get(refreshCookie)?.value).toBe("test-refresh");
    expect(response.cookies.get(stateCookie)?.maxAge).toBe(0);
    expect(response.headers.get("set-cookie")).not.toContain("test-access");
  });

  it("keeps provider token data inert inside the HTML response", async () => {
    const token = "</script><script>globalThis.pwned=true</script>\u2028\u2029";
    fetchMock.mockResolvedValueOnce(Response.json({ access_token: token, expires_in: 3600 }));
    const response = await callback(request({ state, code: "test-code" }));
    const { html, message } = await messageFrom(response);
    expect(html).not.toContain("</script><script>");
    expect(message.token).toBe(token);
    expect(response.cookies.get(refreshCookie)).toBeUndefined();
  });

  it.each(["http", "network", "invalid-json", "invalid-token"])("returns a controlled error and consumes state after a token failure (%s)", async (failure) => {
    if (failure === "http") fetchMock.mockResolvedValueOnce(new Response("provider details", { status: 400 }));
    if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("network details"));
    if (failure === "invalid-json") fetchMock.mockResolvedValueOnce(new Response("invalid json"));
    if (failure === "invalid-token") fetchMock.mockResolvedValueOnce(Response.json({ access_token: "", expires_in: "bad" }));
    const response = await callback(request({ state, code: "test-code" }));
    expect(response.status).toBe(502);
    const { html, message } = await messageFrom(response);
    expect(message).toEqual({ type: "SPOTIFY_AUTH_ERROR", error: "token_exchange_failed" });
    expect(html).not.toContain("details");
    expect(response.cookies.get(refreshCookie)).toBeUndefined();
    expect(response.cookies.get(stateCookie)?.maxAge).toBe(0);
  });
});
