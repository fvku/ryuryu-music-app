import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const origin = "http://127.0.0.1:3000";
let listeners: Map<string, EventListener>;
let popup: { closed: boolean };
let open: ReturnType<typeof vi.fn>;
let fakeWindow: { location: { origin: string }; open: typeof open; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  listeners = new Map(); popup = { closed: false }; open = vi.fn(() => popup);
  fakeWindow = {
    location: { origin }, open,
    addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function message(data: unknown, source: unknown = popup, from = origin) {
  listeners.get("message")?.({ data, source, origin: from } as unknown as Event);
}
function cleanedUp() {
  expect(listeners.has("message")).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
}

describe("Spotify popup completion", () => {
  it("installs the message receiver before opening the popup and completes once", async () => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    open.mockImplementation(() => {
      expect(listeners.has("message")).toBe(true);
      return popup;
    });
    const success = vi.fn(), error = vi.fn();
    openSpotifyAuthPopup(success, error);
    message({ type: "SPOTIFY_AUTH_SUCCESS", token: "test-access", expiresIn: 3600 });
    message({ type: "SPOTIFY_AUTH_SUCCESS", token: "duplicate", expiresIn: 3600 });
    expect(success).toHaveBeenCalledExactlyOnceWith("test-access", 3600);
    expect(error).not.toHaveBeenCalled(); cleanedUp();
  });
  it("rejects messages from a different origin or a different same-origin window", async () => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    const success = vi.fn(), error = vi.fn();
    openSpotifyAuthPopup(success, error);
    message({ type: "SPOTIFY_AUTH_SUCCESS", token: "bad", expiresIn: 3600 }, popup, "https://other.example");
    message({ type: "SPOTIFY_AUTH_SUCCESS", token: "bad", expiresIn: 3600 }, {});
    expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    message({ type: "SPOTIFY_AUTH_ERROR", error: "state_mismatch" });
    expect(error).toHaveBeenCalledExactlyOnceWith("state_mismatch"); cleanedUp();
  });
  it("exits connecting when the popup is blocked", async () => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    open.mockReturnValue(null);
    const error = vi.fn(); openSpotifyAuthPopup(vi.fn(), error);
    expect(error).toHaveBeenCalledExactlyOnceWith("popup_blocked"); cleanedUp();
  });
  it("exits connecting when the popup is closed without a result", async () => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    const error = vi.fn(); openSpotifyAuthPopup(vi.fn(), error);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(1500);
    expect(error).toHaveBeenCalledExactlyOnceWith("cancelled"); cleanedUp();
  });
  it("has a deadline when no completion message arrives", async () => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    const error = vi.fn(); openSpotifyAuthPopup(vi.fn(), error);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(error).toHaveBeenCalledExactlyOnceWith("timeout"); cleanedUp();
  });
  it.each([
    { token: "", expiresIn: 3600 }, { token: "test", expiresIn: "3600" },
    { token: "test", expiresIn: -1 }, { token: "test", expiresIn: Infinity },
  ])("rejects malformed token messages (%j)", async value => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    const success = vi.fn(), error = vi.fn(); openSpotifyAuthPopup(success, error);
    message({ type: "SPOTIFY_AUTH_SUCCESS", ...value });
    expect(success).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith("invalid_response"); cleanedUp();
  });
  it("reports a storage failure instead of keeping the UI busy after a successful message", async () => {
    const { openSpotifyAuthPopup } = await import("./spotify-token");
    const error = vi.fn(); openSpotifyAuthPopup(() => { throw new Error("storage unavailable"); }, error);
    message({ type: "SPOTIFY_AUTH_SUCCESS", token: "test", expiresIn: 3600 });
    expect(error).toHaveBeenCalledWith("storage_unavailable"); cleanedUp();
  });
});
