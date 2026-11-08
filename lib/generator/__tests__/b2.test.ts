import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { audioSignatureMatches, b2Config, b2ObjectUrl, presignUrl } from "../b2";

afterEach(() => { vi.unstubAllEnvs(); });

describe("B2（S3互換）の署名付きURL", () => {
  it("matches AWS's published SigV4 query-signing example", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html の例
    const url = presignUrl({
      method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expires: 86400, now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toBe("https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256"
      + "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z"
      + "&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
  it("builds path-style URLs for the configured bucket and refuses keys outside the audio area", () => {
    vi.stubEnv("B2_KEY_ID", "key"); vi.stubEnv("B2_APPLICATION_KEY", "secret");
    vi.stubEnv("B2_BUCKET", "ryuryu-generator-audio"); vi.stubEnv("B2_ENDPOINT", "https://s3.us-west-004.backblazeb2.com/");
    expect(b2Config()).toEqual(expect.objectContaining({ host: "s3.us-west-004.backblazeb2.com", region: "us-west-004" }));
    const key = "audio/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.mp3";
    const url = new URL(b2ObjectUrl("PUT", key, 600));
    expect(url.pathname).toBe(`/ryuryu-generator-audio/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^key\/\d{8}\/us-west-004\/s3\/aws4_request$/);
    expect(new URL(b2ObjectUrl("DELETE", key, 60, { versionId: "4_z1+2" })).searchParams.get("versionId")).toBe("4_z1+2");
    expect(() => b2ObjectUrl("GET", "../secret.mp3", 60)).toThrow();
  });
  it("reports a missing configuration as 503 without leaking values", () => {
    vi.stubEnv("B2_KEY_ID", ""); 
    expect(() => b2Config()).toThrow(/設定されていません/);
  });
  it("recognises MP3 and MP4 headers", () => {
    expect(audioSignatureMatches(new Uint8Array([0x49, 0x44, 0x33, 4]), "audio/mpeg")).toBe(true);
    expect(audioSignatureMatches(new Uint8Array([0xff, 0xfb, 0x90]), "audio/mpeg")).toBe(true);
    expect(audioSignatureMatches(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]), "audio/mp4")).toBe(true);
    expect(audioSignatureMatches(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "audio/mp4")).toBe(false);
    expect(audioSignatureMatches(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]), "audio/mpeg")).toBe(false);
  });
});
