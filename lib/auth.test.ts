import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ nextAuth: vi.fn<(config: unknown) => object>(() => ({})) }));
vi.mock("next-auth", () => ({ default: mocks.nextAuth }));
import "./auth";

const config = mocks.nextAuth.mock.calls[0][0] as unknown as {
  providers: { id: string }[];
  callbacks: { signIn: (input: unknown) => Promise<boolean> };
};
const email = "kohei.fuku0926@gmail.com";
afterEach(() => vi.unstubAllEnvs());
describe("application sign-in policy", () => {
  it("exposes Google only; Spotify playback connection remains a separate OAuth flow", () => {
    expect(config.providers.map(provider => provider.id)).toEqual(["google"]);
  });
  it("requires a verified matching Google email and the current member allowlist", async () => {
    vi.stubEnv("ALLOWED_MEMBER_EMAILS", "");
    const valid = { user: { email }, account: { provider: "google" }, profile: { email, email_verified: true } };
    expect(await config.callbacks.signIn(valid)).toBe(true);
    expect(await config.callbacks.signIn({ ...valid, account: { provider: "spotify" } })).toBe(false);
    expect(await config.callbacks.signIn({ ...valid, profile: { email, email_verified: false } })).toBe(false);
    expect(await config.callbacks.signIn({ ...valid, profile: { email: "different@example.com", email_verified: true } })).toBe(false);
    vi.stubEnv("ALLOWED_MEMBER_EMAILS", "other@example.com");
    expect(await config.callbacks.signIn(valid)).toBe(false);
  });
});
