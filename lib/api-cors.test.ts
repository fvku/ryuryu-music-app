import { describe, it, expect } from "vitest";
import { READ_CORS_HEADERS, corsJson, corsPreflight } from "@/lib/api-cors";

describe("READ_CORS_HEADERS", () => {
  it("allows any origin so the distributed single-HTML tool can call it", () => {
    expect(READ_CORS_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("allows the Authorization header, which is what forces the preflight", () => {
    expect(READ_CORS_HEADERS["Access-Control-Allow-Headers"]).toContain("Authorization");
  });

  it("advertises only GET and OPTIONS, so cross-origin PATCH stays blocked", () => {
    const methods = READ_CORS_HEADERS["Access-Control-Allow-Methods"];
    expect(methods).toContain("GET");
    expect(methods).toContain("OPTIONS");
    expect(methods).not.toContain("PATCH");
    expect(methods).not.toContain("POST");
    expect(methods).not.toContain("DELETE");
  });
});

describe("corsPreflight", () => {
  it("returns 204 with the CORS headers", () => {
    const res = corsPreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});

describe("corsJson", () => {
  it("attaches the CORS headers to a success response", async () => {
    const res = corsJson([{ title: "x" }]);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual([{ title: "x" }]);
  });

  it("attaches them to error responses too, so the browser can read the status", () => {
    const res = corsJson({ error: "認証が必要です" }, { status: 401 });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("keeps caller-supplied headers", () => {
    const res = corsJson({ ok: true }, { headers: { "X-Test": "1" } });
    expect(res.headers.get("x-test")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
