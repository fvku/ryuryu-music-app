import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_JOBS, formatCronReport, summarizeCronLogs } from "./cron-status";

const now = new Date("2026-11-11T04:00:00Z");
const row = (at: string, result = "ok", name = "sync-playlist-tags", actor = "cron") => [at, actor, `cron:${name}`, result];

describe("Cron status and handoff", () => {
  it("keeps failures visible until a later success, using timestamps and append order", () => {
    const report = summarizeCronLogs([
      row("2026-11-11T03:00:00Z", "failed"), row("2026-11-10T03:00:00Z"),
      row("2026-11-11T02:00:00Z", "failed", "supabase-keepalive"),
      row("2026-11-11T02:00:00Z", "ok", "supabase-keepalive"),
    ], now);
    expect(report.jobs[0].health).toBe("failed");
    expect(report.jobs[2].health).toBe("ok");
    expect(report.jobs[1].health).toBe("unknown");
    expect(report.attentionCount).toBe(2);
  });

  it("flags an absent or old record without treating it as a successful run", () => {
    const report = summarizeCronLogs([row("2026-11-09T16:00:00Z")], now);
    expect(report.jobs[0].health).toBe("stale");
    expect(report.attentionCount).toBe(3);
    expect(summarizeCronLogs([], now, false).logAvailable).toBe(false);
  });

  it("ignores other actions and actors but surfaces malformed or future Cron records", () => {
    const report = summarizeCronLogs([
      ...CRON_JOBS.map(job => row("2026-11-11T03:00:00Z", "ok", job.name)),
      row("bad", "failed", "unrelated"), row("bad", "failed", "sync-playlist-tags", "member"),
      row("bad"), row("2026-11-12T03:00:00Z"), row("2026-11-11T03:00:00Z", "denied"),
    ], now);
    expect(report.invalidRecordCount).toBe(3);
    expect(report.attentionCount).toBe(1);
  });

  it("returns only five recent safe records and no free text or identities", () => {
    const rows = Array.from({ length: 9 }, (_, i) => [...row(`2026-11-11T0${i % 4}:00:00Z`), "SECRET_ERROR_TOKEN"]);
    const report = summarizeCronLogs(rows, now);
    expect(report.jobs[0].recent).toHaveLength(5);
    expect(JSON.stringify(report)).not.toContain("SECRET_ERROR_TOKEN");
    expect(formatCronReport(report)).toContain("担当: Kohei");
    expect(formatCronReport(report)).toContain("本番Sheetsへの変更・復元");
    expect(formatCronReport(report)).not.toContain("SECRET_ERROR_TOKEN");
  });
});

const mocks = vi.hoisted(() => ({ auth: vi.fn(), googleAuth: vi.fn(), meta: vi.fn(), values: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/google-auth", () => ({ getGoogleAuth: mocks.googleAuth }));
vi.mock("googleapis", () => ({ google: { sheets: () => ({ spreadsheets: {
  get: mocks.meta, batchUpdate: mocks.write,
  values: { get: mocks.values, update: mocks.write, append: mocks.write },
} }) } }));

import { GET } from "@/app/api/admin/cron-status/route";
import { readCronStatus } from "./cron-status-store";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_SPREADSHEET_ID", "test-sheet");
  vi.stubEnv("ALLOWED_MEMBER_EMAILS", "member@example.com");
  mocks.auth.mockResolvedValue({ user: { email: "member@example.com" }, loginProvider: "google", googleVerifiedEmail: "member@example.com" });
  mocks.meta.mockResolvedValue({ data: { sheets: [{ properties: { title: "admin_logs" } }] } });
  mocks.values.mockResolvedValue({ data: { values: [["timestamp", "email", "action", "result"], row("2026-11-11T03:00:00Z")] } });
});
afterEach(() => vi.unstubAllEnvs());

describe("read-only status API", () => {
  it.each([
    [null, 401], [{ user: { email: "member@example.com" } }, 401],
    [{ user: { email: "outsider@example.com" } }, 403],
  ])("rejects unauthorized reads before contacting Sheets (%j)", async (session, status) => {
    mocks.auth.mockResolvedValue(session);
    expect((await GET()).status).toBe(status);
    expect(mocks.meta).not.toHaveBeenCalled();
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("uses readonly scope, omits details, and prevents response caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.googleAuth).toHaveBeenCalledWith(false);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ range: "admin_logs!A:D" }));
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("reports a missing sheet without creating one", async () => {
    mocks.meta.mockResolvedValue({ data: { sheets: [] } });
    const report = await readCronStatus();
    expect(report.logAvailable).toBe(false);
    expect(report.attentionCount).toBe(3);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not replace a read failure with healthy data or leak upstream error text", async () => {
    mocks.values.mockRejectedValue(new Error("SECRET_ERROR_TOKEN"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET_ERROR_TOKEN");
  });

  it("rejects unexpected headers instead of showing incorrect results", async () => {
    mocks.values.mockResolvedValue({ data: { values: [["email", "timestamp", "action", "result"]] } });
    expect((await GET()).status).toBe(503);
  });
});
