import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sheetGet: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("googleapis", () => ({ google: {
  auth: { GoogleAuth: class GoogleAuth {} },
  sheets: () => ({ spreadsheets: { values: { get: mocks.sheetGet } } }),
} }));

import { GET } from "@/app/api/generator/source/route";

const email = "kohei.fuku0926@gmail.com";
const headers = ["No.", "日付", "アルバム名", "アーティスト", "unused", "洋邦", "Time", "#", "WEEK", "M/J採用", "UID", "spotifyカバー", "画像リンク変換"];
const row = (values: Record<string, string>) => headers.map(header => values[header] || "");

beforeEach(() => {
  mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ user: { email }, loginProvider: "google", googleVerifiedEmail: email });
  mocks.sheetGet.mockReset(); mocks.sheetGet.mockResolvedValue({ data: { values: [headers,
    row({ "No.": "1", "日付": "2027/01/01", "アルバム名": "Weekly Album", アーティスト: "Artist", 洋邦: "洋楽", Time: "9songs, 35min", "#": "53", WEEK: "採用", "M/J採用": "不採用", UID: "weekly-uid", spotifyカバー: "https://example.com/spotify.jpg", 画像リンク変換: "https://example.com/apple.jpg" }),
  ] } });
  vi.stubEnv("RELEASE_MASTER_SPREADSHEET_ID", "sheet-test");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", JSON.stringify({ client_email: "test@example.com", private_key: "test" }));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("generator source route", () => {
  it("imports a Friday Weekly request from WEEK adoption without consulting M/J adoption", async () => {
    const response = await GET(new Request("https://app.example/api/generator/source?series=weekly&week=2027-01-01"));
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document).toMatchObject({ series: "weekly", rendererVersion: "weekly-v1", period: { type: "week", start: "2027-01-01", end: "2027-01-08", weekNumber: 53 } });
    expect(document.pages.map((page: { kind: string }) => page.kind)).toEqual(["cover", "feature", "others"]);
    expect(document.items[0].source.coverUrl).toBe("https://example.com/apple.jpg");
    expect(mocks.sheetGet).toHaveBeenCalledWith({ spreadsheetId: "sheet-test", range: "'Release Master'!A1:AZ" });
  });
  it("rejects non-Friday and mismatched Weekly parameters before reading Sheets", async () => {
    const nonFriday = await GET(new Request("https://app.example/api/generator/source?series=weekly&week=2027-01-02"));
    const wrongName = await GET(new Request("https://app.example/api/generator/source?series=weekly&month=2027-01-01"));
    expect(nonFriday.status).toBe(400); expect(wrongName.status).toBe(400); expect(mocks.sheetGet).not.toHaveBeenCalled();
  });
  it("keeps the existing Monthly query contract", async () => {
    mocks.sheetGet.mockResolvedValueOnce({ data: { values: [headers,
      row({ "No.": "1", "日付": "2026/08/07", "アルバム名": "Monthly Album", アーティスト: "Artist", 洋邦: "洋楽", "M/J採用": "採用", UID: "monthly-uid" }),
    ] } });
    const response = await GET(new Request("https://app.example/api/generator/source?series=monthly&month=2026-08"));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ series: "monthly", rendererVersion: "monthly-japan-v1" });
  });
});
