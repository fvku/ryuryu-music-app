import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(async () => ({})),
  batchUpdate: vi.fn(async () => ({})),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({
  user: { email: "kohei.fuku0926@gmail.com" }, loginProvider: "google", googleVerifiedEmail: "kohei.fuku0926@gmail.com",
})) }));
vi.mock("@/lib/google-auth", () => ({ getGoogleAuth: () => ({}) }));
vi.mock("googleapis", () => ({ google: { sheets: () => ({ spreadsheets: { values: {
  get: mocks.get, update: mocks.update, batchUpdate: mocks.batchUpdate,
} } }) } }));

import { PATCH } from "@/app/api/release-master/[no]/route";

const HEADER = ["No.", "Date", "Title", "Artist", "genre", "国", "Track", "M Number", "Start Time", "M/J採用（220−300）", "UID"];
// 行: 原稿と国が入っている。開いた後に誰かが原稿を書き換えた状態を current として返す
function sheetWith(row: Partial<Record<string, string>>) {
  const values = HEADER.map((h) => row[h] ?? "");
  mocks.get.mockResolvedValue({ data: { values: [HEADER, values] } });
}

function patch(body: unknown) {
  return PATCH(new NextRequest("https://app.example/api/release-master/12", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://app.example", host: "app.example" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.stubEnv("RELEASE_MASTER_SPREADSHEET_ID", "rm");
  mocks.get.mockReset();
  mocks.update.mockClear();
  mocks.batchUpdate.mockClear();
});

describe("PATCH /api/release-master/[no] のM/J保存", () => {
  it("開いた後に他の人が原稿を保存していたら書き込まずに409を返す", async () => {
    sheetWith({ "No.": "12", UID: "abcd1234", "M/J採用（220−300）": "Aの原稿", "国": "UK" });
    const res = await patch({ uid: "abcd1234", base: { mjText: "元の原稿" }, mjData: { mjText: "Bの原稿" } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflicts).toEqual([{ field: "mjText", current: "Aの原稿" }]);
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it("国だけ直した保存は国の列だけを書き、他の人の原稿を戻さない", async () => {
    sheetWith({ "No.": "12", UID: "abcd1234", "M/J採用（220−300）": "Aの原稿", "国": "UK" });
    const res = await patch({ uid: "abcd1234", base: { country: "UK" }, albumMeta: { country: "US" } });
    expect(res.status).toBe(200);
    expect(mocks.batchUpdate).toHaveBeenCalledOnce();
    const data = (mocks.batchUpdate.mock.calls[0] as unknown as [{ requestBody: { data: { range: string; values: string[][] }[] } }])[0].requestBody.data;
    expect(data).toEqual([{ range: "'Release Master'!F2", values: [["US"]] }]);
  });

  it("曲を送らなければ保存済みのおすすめ曲の列に触れない", async () => {
    sheetWith({ "No.": "12", UID: "abcd1234", Track: "Song", "M Number": "3", "M/J採用（220−300）": "元" });
    const res = await patch({ uid: "abcd1234", base: { mjText: "元" }, mjData: { mjText: "直した原稿" } });
    expect(res.status).toBe(200);
    const data = (mocks.batchUpdate.mock.calls[0] as unknown as [{ requestBody: { data: { range: string }[] } }])[0].requestBody.data;
    expect(data.map((d) => d.range)).toEqual(["'Release Master'!J2"]);
  });
});
