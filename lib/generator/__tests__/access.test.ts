import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { recordLoginIdentity } from "../../auth-identity";
import { isAllowedMember } from "../../member-access";
import { generatorActor, canBypassGeneratorPage, checkOrigin, readBody } from "../access";

const email = "kohei.fuku0926@gmail.com";
const session: Session = { expires: "2030-01-01", user: { email }, loginProvider: "google", googleVerifiedEmail: email };
describe("generator access boundary", () => {
  it("preserves exact email matching and env allowlist precedence", () => {
    expect(isAllowedMember(email, " , ")).toBe(true);
    expect(isAllowedMember(email.toUpperCase(), "")).toBe(false);
    expect(isAllowedMember(email, "other@example.com")).toBe(false);
    expect(isAllowedMember("other@example.com", " other@example.com, ")).toBe(true);
  });
  it("rejects anonymous, revoked, old-session and Spotify-only access", () => {
    expect(() => generatorActor(null, "")).toThrow();
    expect(() => generatorActor(session, "other@example.com")).toThrow();
    expect(() => generatorActor({ ...session, loginProvider: undefined }, "")).toThrow();
    expect(() => generatorActor({ ...session, googleVerifiedEmail: undefined }, "")).toThrow();
    expect(() => generatorActor({ ...session, loginProvider: "spotify" }, "")).toThrow();
    expect(generatorActor(session, "")).toBe(email);
  });
  it("allows an allowlisted actor only for an explicitly enabled localhost preview", () => {
    const local = {
      GENERATOR_LOCAL_PREVIEW_AUTH_BYPASS: "true",
      GENERATOR_LOCAL_PREVIEW_ACTOR: email,
      AUTH_URL: "http://localhost:3456",
    };
    expect(generatorActor(null, "", local)).toBe(email);
    expect(() => generatorActor(null, "", { ...local, AUTH_URL: "https://preview.example.com" })).toThrow();
    expect(() => generatorActor(null, "", { ...local, VERCEL: "1" })).toThrow();
    expect(() => generatorActor(null, "other@example.com", local)).toThrow();
    expect(() => generatorActor(null, "", { ...local, GENERATOR_LOCAL_PREVIEW_ACTOR: email.toUpperCase() })).toThrow();
    expect(canBypassGeneratorPage("/generator", "", local)).toBe(true);
    expect(canBypassGeneratorPage("/generator/document-id", "", local)).toBe(true);
    expect(canBypassGeneratorPage("/generatorish", "", local)).toBe(false);
    expect(canBypassGeneratorPage("/", "", local)).toBe(false);
    expect(canBypassGeneratorPage("/generator", "", { ...local, VERCEL: "1" })).toBe(false);
  });
  it("records only actual verified Google callback data, clearing stale proof on another provider login", () => {
    const token = recordLoginIdentity({ email }, { provider: "google" }, { email, email_verified: true });
    expect(token.googleVerifiedEmail).toBe(email);
    expect(recordLoginIdentity(token, undefined)).toEqual(token);
    expect(recordLoginIdentity(token, { provider: "spotify" }).googleVerifiedEmail).toBeUndefined();
    expect(recordLoginIdentity({ email }, { provider: "google" }, { email, email_verified: false }).googleVerifiedEmail).toBeUndefined();
    expect(recordLoginIdentity({ email }, { provider: "google" }, { email: "different@example.com", email_verified: true }).googleVerifiedEmail).toBeUndefined();
  });
  it("rejects missing/null/foreign origins and cross-site writes", () => {
    for (const origin of [undefined, "null", "https://evil.invalid"]) {
      const request = new Request("https://app.example/api", { headers: origin ? { origin } : {} });
      expect(() => checkOrigin(request)).toThrow();
    }
    expect(() => checkOrigin(new Request("https://app.example/api", { headers: { origin: "https://app.example", "sec-fetch-site": "cross-site" } }))).toThrow();
    expect(() => checkOrigin(new Request("https://app.example/api", { headers: { origin: "https://app.example" } }))).not.toThrow();
  });
  it("bounds actual body bytes, including requests with no Content-Length", async () => {
    const request = (body: string) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(await readBody(request('{"test":true}'))).toEqual({ test: true });
    await expect(readBody(request("not json"))).rejects.toThrow();
    await expect(readBody(request('"' + "あ".repeat(400000) + '"'))).rejects.toMatchObject({ status: 413 });
    await expect(readBody(new Request("http://localhost/api", { method: "POST", body: "{}" }))).rejects.toMatchObject({ status: 415 });
  });
});
