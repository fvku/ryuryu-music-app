import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ httpsRequest: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:https", () => ({ request: mocks.httpsRequest }));

import { GeneratorError } from "../errors";
import { fetchGeneratorImage, isPublicImageAddress, parseRemoteImageUrl, requestRemoteImageAtAddress } from "../remote-image";

function png(width = 10, height = 20) {
  const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10], 0); bytes.set([73,72,68,82], 12);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

describe("remote generator image fetching", () => {
  beforeEach(() => mocks.httpsRequest.mockReset());

  it.each([
    ["8.8.8.8", true],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["10.0.0.1", false],
    ["100.64.0.1", false],
    ["192.0.2.1", false],
    ["2606:4700:4700::1111", true],
    ["::1", false],
    ["::ffff:127.0.0.1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["2001:db8::1", false],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicImageAddress(address)).toBe(expected);
  });

  it("accepts only credential-free https URLs", () => {
    expect(parseRemoteImageUrl("https://images.example/cover.jpg#part").toString()).toBe("https://images.example/cover.jpg");
    for (const value of ["http://images.example/a.jpg", "https://user:secret@images.example/a.jpg", "not a url"]) {
      expect(() => parseRemoteImageUrl(value)).toThrow(GeneratorError);
    }
  });

  it("revalidates and resolves each redirect, then detects the image from bytes", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 302, location: "https://cdn.example/cover.png", bytes: null })
      .mockResolvedValueOnce({ status: 200, location: null, bytes: png() });
    const result = await fetchGeneratorImage("https://origin.example/start", { resolve, request });
    expect(result).toMatchObject({ mimeType: "image/png", width: 10, height: 20 });
    expect(result.bytes).toEqual(png());
    expect(resolve).toHaveBeenNthCalledWith(1, "origin.example");
    expect(resolve).toHaveBeenNthCalledWith(2, "cdn.example");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect whose freshly resolved destination is private", async () => {
    const resolve = vi.fn(async (hostname: string) => [{ address: hostname === "private.example" ? "127.0.0.1" : "93.184.216.34", family: 4 as const }]);
    const request = vi.fn().mockResolvedValue({ status: 302, location: "https://private.example/cover.png", bytes: null });
    await expect(fetchGeneratorImage("https://origin.example/start", { resolve, request })).rejects.toMatchObject({ code: "INVALID_IMAGE_URL", status: 400 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image response bytes even when the fetch succeeded", async () => {
    const dependencies = {
      resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      request: vi.fn(async () => ({ status: 200, location: null, bytes: new Uint8Array(24) })),
    };
    await expect(fetchGeneratorImage("https://images.example/not-image", dependencies)).rejects.toMatchObject({ code: "INVALID_IMAGE", status: 400 });
  });

  it("pins the HTTPS socket lookup to the already validated address", async () => {
    let options: { lookup(hostname: string, options: { all: boolean }, callback: (...args: unknown[]) => void): void } | undefined;
    mocks.httpsRequest.mockImplementation((_url, requestOptions, onResponse) => {
      options = requestOptions;
      const request = new EventEmitter() as EventEmitter & { end(): void };
      request.end = () => {
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
        response.statusCode = 200; response.headers = {};
        onResponse(response); response.end(png());
      };
      return request;
    });
    const address = { address: "93.184.216.34", family: 4 as const };
    const response = await requestRemoteImageAtAddress(new URL("https://images.example/cover.png"), address);
    expect(response.bytes).toEqual(png());
    const lookup = vi.fn();
    options!.lookup("images.example", { all: true }, lookup);
    expect(lookup).toHaveBeenCalledWith(null, [address]);
    expect(mocks.httpsRequest.mock.calls[0][1]).toMatchObject({ agent: false, method: "GET" });
    expect(mocks.httpsRequest.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    expect(mocks.httpsRequest.mock.calls[0][1].headers).not.toHaveProperty("Cookie");
  });

  it("stops a streamed response once its actual size exceeds 10MB", async () => {
    mocks.httpsRequest.mockImplementation((_url, _options, onResponse) => {
      const request = new EventEmitter() as EventEmitter & { end(): void };
      request.end = () => {
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
        response.statusCode = 200; response.headers = {};
        onResponse(response); response.end(Buffer.alloc(10 * 1024 * 1024 + 1));
      };
      return request;
    });
    await expect(requestRemoteImageAtAddress(new URL("https://images.example/too-large"), { address: "93.184.216.34", family: 4 }))
      .rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });
});
