import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { GeneratorError } from "./errors";
import { detectGeneratorImageMime, inspectGeneratorImage, type GeneratorImage } from "./image";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

type RemoteAddress = { address: string; family: 4 | 6 };
type RemoteResponse = { status: number; location: string | null; bytes: Uint8Array | null };
type RemoteImageDependencies = {
  resolve(hostname: string): Promise<RemoteAddress[]>;
  request(url: URL, address: RemoteAddress): Promise<RemoteResponse>;
};

export type FetchedGeneratorImage = GeneratorImage & { bytes: Uint8Array };

function invalidUrl(message = "公開されたhttps画像のURLを指定してください。"): never {
  throw new GeneratorError("INVALID_IMAGE_URL", 400, message);
}

function unavailable(): never {
  throw new GeneratorError("IMAGE_FETCH_FAILED", 422, "画像URLから画像を取得できませんでした。URLと配信元の応答を確認してください。");
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    result = result * 256 + value;
  }
  return result;
}

function inIpv4Subnet(address: number, base: number, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(address / size) === Math.floor(base / size);
}

function publicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const blocked: [number, number][] = [
    [0x00000000, 8],   // current network
    [0x0a000000, 8],   // private
    [0x64400000, 10],  // carrier-grade NAT
    [0x7f000000, 8],   // loopback
    [0xa9fe0000, 16],  // link-local, including cloud metadata
    [0xac100000, 12],  // private
    [0xc0000000, 24],  // IETF protocol assignments
    [0xc0000200, 24],  // documentation
    [0xc0586300, 24],  // deprecated relay anycast
    [0xc0a80000, 16],  // private
    [0xc6120000, 15],  // benchmark
    [0xc6336400, 24],  // documentation
    [0xcb007100, 24],  // documentation
    [0xe0000000, 4],   // multicast and reserved
  ];
  return !blocked.some(([base, prefix]) => inIpv4Subnet(value, base, prefix));
}

function ipv6Words(address: string): number[] | null {
  if (address.includes("%") || address.split("::").length > 2) return null;
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (normalized.includes(".")) {
    const ipv4 = ipv4Number(normalized.slice(lastColon + 1));
    if (ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((normalized.includes("::") && missing < 1) || (!normalized.includes("::") && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map(part => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : -1);
  return words.length === 8 && words.every(word => word >= 0 && word <= 0xffff) ? words : null;
}

function publicIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (!words) return false;
  // Only globally routable unicast space is accepted. This rejects loopback,
  // unique-local, link-local, multicast, IPv4-mapped and NAT64 addresses.
  if ((words[0] & 0xe000) !== 0x2000) return false;
  // IETF special-purpose space, documentation, 6to4, and the second
  // documentation prefix are unsuitable as remote fetch destinations.
  if (words[0] === 0x2001 && words[1] <= 0x01ff) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  if (words[0] === 0x2002) return false;
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false;
  return true;
}

/** SSRF防止のため、接続先として使える公開IPだけを通す。 */
export function isPublicImageAddress(address: string): boolean {
  const normalized = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const family = isIP(normalized);
  return family === 4 ? publicIpv4(normalized) : family === 6 ? publicIpv6(normalized) : false;
}

export function parseRemoteImageUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length < 1 || value.length > 2000) invalidUrl();
  let url: URL;
  try { url = new URL(value); } catch { invalidUrl(); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) invalidUrl();
  url.hash = "";
  return url;
}

async function resolvePublicAddresses(hostname: string): Promise<RemoteAddress[]> {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  let values: RemoteAddress[];
  try {
    const family = isIP(bare);
    values = family ? [{ address: bare, family: family as 4 | 6 }] : await dnsLookup(bare, { all: true, verbatim: true }) as RemoteAddress[];
  } catch { unavailable(); }
  if (!values.length || values.some(value => !isPublicImageAddress(value.address))) {
    invalidUrl("ローカルネットワークや予約済みアドレスの画像は取得できません。");
  }
  return values;
}

function responseLength(value: string | string[] | undefined): number | null {
  if (Array.isArray(value) || value === undefined || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

export function requestRemoteImageAtAddress(url: URL, address: RemoteAddress): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    const request = httpsRequest(url, {
      method: "GET",
      agent: false,
      headers: {
        Accept: "image/png,image/jpeg,image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": "ryuryu-music-generator/1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Resolve once, validate above, then pin this connection to that exact
      // address. A second DNS lookup at connect time would permit rebinding.
      lookup: (_hostname, options, callback) => {
        // Modern Node asks custom lookups for `all: true` when automatic
        // address-family selection is enabled. Return one pinned address in
        // either callback shape; never hand the socket layer a second DNS set.
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const status = response.statusCode || 0;
      const location = typeof response.headers.location === "string" ? response.headers.location : null;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        finish(() => resolve({ status, location, bytes: null }));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        finish(() => reject(new Error("remote status")));
        return;
      }
      const declared = responseLength(response.headers["content-length"]);
      if (declared !== null && declared > MAX_IMAGE_BYTES) {
        response.destroy();
        finish(() => reject(new GeneratorError("PAYLOAD_TOO_LARGE", 413, "画像は10MB以下にしてください。")));
        return;
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        length += chunk.byteLength;
        if (length > MAX_IMAGE_BYTES) {
          response.destroy();
          finish(() => reject(new GeneratorError("PAYLOAD_TOO_LARGE", 413, "画像は10MB以下にしてください。")));
          return;
        }
        chunks.push(new Uint8Array(chunk));
      });
      response.once("end", () => finish(() => {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        resolve({ status, location: null, bytes });
      }));
      response.once("error", error => finish(() => reject(error)));
    });
    request.once("error", error => finish(() => reject(error)));
    request.end();
  });
}

/**
 * 公開HTTPS URLを資格情報なしで取得し、リダイレクトごとにDNSと宛先を再検査する。
 * Content-Typeヘッダーは使わず、取得したバイトの署名と寸法だけを信頼する。
 */
export async function fetchGeneratorImage(
  value: unknown,
  dependencies: RemoteImageDependencies = { resolve: resolvePublicAddresses, request: requestRemoteImageAtAddress },
): Promise<FetchedGeneratorImage> {
  let url = parseRemoteImageUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response: RemoteResponse;
    try {
      const addresses = await dependencies.resolve(url.hostname);
      if (!addresses.length || addresses.some(entry => !isPublicImageAddress(entry.address))) {
        invalidUrl("ローカルネットワークや予約済みアドレスの画像は取得できません。");
      }
      response = await dependencies.request(url, addresses[0]);
    } catch (error) {
      if (error instanceof GeneratorError) throw error;
      unavailable();
    }
    if (response.bytes) {
      const mimeType = detectGeneratorImageMime(response.bytes);
      const image = inspectGeneratorImage(response.bytes, mimeType);
      return { bytes: response.bytes, ...image };
    }
    if (!response.location || redirects === MAX_REDIRECTS) unavailable();
    try { url = parseRemoteImageUrl(new URL(response.location, url).toString()); } catch (error) {
      if (error instanceof GeneratorError) throw error;
      unavailable();
    }
  }
  unavailable();
}
