import { beforeEach, describe, expect, it, vi } from "vitest";

/** シートをメモリ上で再現する（A1形式の範囲だけ扱う最小限の偽物） */
const db = vi.hoisted(() => ({
  sheets: new Map<string, string[][]>(),
  calls: [] as string[],
}));

function parseRange(range: string) {
  const m = range.match(/^'?([^'!]+)'?!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
  if (!m) throw new Error(`range: ${range}`);
  const colNum = (c: string) => c.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { sheet: m[1], c1: colNum(m[2]), r1: m[3] ? Number(m[3]) - 1 : 0, c2: m[4] ? colNum(m[4]) : colNum(m[2]), r2: m[5] ? Number(m[5]) - 1 : Infinity };
}
function key(id: string, sheet: string) { return `${id}/${sheet}`; }

vi.mock("@/lib/google-auth", () => ({ getGoogleAuth: () => ({}) }));
vi.mock("googleapis", () => {
  const values = {
    get: async ({ spreadsheetId, range }: { spreadsheetId: string; range: string }) => {
      const r = parseRange(range);
      const rows = db.sheets.get(key(spreadsheetId, r.sheet));
      if (!rows) throw new Error("Unable to parse range");
      const out = rows.slice(r.r1, r.r2 === Infinity ? undefined : r.r2 + 1).map((row) => row.slice(r.c1, r.c2 + 1));
      return { data: { values: out } };
    },
    update: async ({ spreadsheetId, range, requestBody }: { spreadsheetId: string; range: string; requestBody: { values: string[][] } }) => {
      db.calls.push(`update ${range}`);
      const r = parseRange(range);
      const rows = db.sheets.get(key(spreadsheetId, r.sheet)) ?? [];
      requestBody.values.forEach((vals, i) => {
        const row = rows[r.r1 + i] ?? (rows[r.r1 + i] = []);
        vals.forEach((v, j) => { row[r.c1 + j] = v; });
      });
      db.sheets.set(key(spreadsheetId, r.sheet), rows);
      return {};
    },
    append: async ({ spreadsheetId, range, requestBody }: { spreadsheetId: string; range: string; requestBody: { values: string[][] } }) => {
      db.calls.push(`append ${range}`);
      const r = parseRange(range);
      const rows = db.sheets.get(key(spreadsheetId, r.sheet)) ?? [];
      rows.push(...requestBody.values.map((v) => [...v]));
      db.sheets.set(key(spreadsheetId, r.sheet), rows);
      return {};
    },
    clear: async ({ spreadsheetId, range }: { spreadsheetId: string; range: string }) => {
      db.sheets.set(key(spreadsheetId, parseRange(range).sheet), []);
      return {};
    },
    batchClear: async () => ({}),
  };
  return {
    google: {
      sheets: () => ({
        spreadsheets: {
          values,
          batchUpdate: async ({ spreadsheetId, requestBody }: { spreadsheetId: string; requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
            for (const r of requestBody.requests) db.sheets.set(key(spreadsheetId, r.addSheet.properties.title), []);
            return {};
          },
        },
      }),
    },
  };
});

import { getReviewQueue, resolveReviewQueueItem, runReviewSync } from "./review-sync";
import { JOURNAL_HEADERS } from "@/lib/review-sync";

const RM_HEADER = ["No.", "日付", "アルバム名", "アーティスト", "UID", "Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa", "Kaede"];
const SCORES_HEADER = ["reviewId", "memberName", "score", "comment", "submittedAt", "albumTitle", "artistName", "albumUid", "requestId"];
const KOHEI = "kohei.fuku0926@gmail.com";

function journalRow(recordedAt: string, uid: string, email: string, value: string, status = "recorded") {
  return ["1", `e-${recordedAt}`, recordedAt, uid, email, JSON.stringify(value), "null", JSON.stringify(value), "single_event", status, "H2", "\"1\"", "\"T\"", "\"A\""];
}

beforeEach(() => {
  vi.stubEnv("RELEASE_MASTER_SPREADSHEET_ID", "rm");
  vi.stubEnv("GOOGLE_SPREADSHEET_ID", "app");
  db.sheets.clear();
  db.calls.length = 0;
  db.sheets.set("rm/Release Master", [
    RM_HEADER,
    ["1", "2026/11/01", "Album One", "Artist", "abcd1234", "", "", "9 シートで直した", "", "", ""],
    ["2", "2026/11/02", "Album Two", "Artist", "efgh5678", "", "", "6 古い内容", "", "", ""],
  ]);
  db.sheets.set("app/scores", [
    SCORES_HEADER,
    ["1", KOHEI, "8", "アプリ", "2026-11-05T00:00:00.000Z", "Album One", "Artist", "abcd1234", ""],
    ["2", KOHEI, "8", "アプリで更新", "2026-11-10T00:00:00.000Z", "Album Two", "Artist", "efgh5678", ""],
  ]);
});

describe("runReviewSync", () => {
  it("履歴が無ければどちらも書き換えず、確認待ちに出す", async () => {
    const result = await runReviewSync({ apply: true });
    expect(result.journalAvailable).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.reviewByReason).toEqual({ time_unknown: 2 });
    expect(db.sheets.get("app/scores")![1][2]).toBe("8");
    expect((await getReviewQueue()).map((q) => q.albumTitle)).toEqual(["Album One", "Album Two"]);
  });

  it("シートの履歴がアプリより新しいものだけ、その時刻で反映する。古いシートでアプリを戻さない", async () => {
    db.sheets.set("rm/_review_edit_log", [
      [...JOURNAL_HEADERS],
      journalRow("2026-11-08T00:00:00.000Z", "abcd1234", KOHEI, "9 シートで直した"),
      journalRow("2026-11-01T00:00:00.000Z", "efgh5678", KOHEI, "6 古い内容"),
    ]);
    const result = await runReviewSync({ apply: true });
    expect(result.applied).toEqual([{ key: `abcd1234::${KOHEI}`, submittedAt: "2026-11-08T00:00:00.000Z" }]);
    const scores = db.sheets.get("app/scores")!;
    expect(scores[1].slice(2, 5).map(String)).toEqual(["9", "シートで直した", "2026-11-08T00:00:00.000Z"]);
    expect(scores[2].slice(2, 5)).toEqual(["8", "アプリで更新", "2026-11-10T00:00:00.000Z"]);
    const queue = await getReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ albumTitle: "Album Two", reason: "app_newer" });
  });

  it("dry-run は何も書かない", async () => {
    await runReviewSync({ apply: false });
    expect(db.calls).toEqual([]);
  });

  it("確認待ちで「アプリの内容を残す」と、シートへ書き戻して履歴に残し、一覧から消える", async () => {
    db.sheets.set("rm/_review_edit_log", [[...JOURNAL_HEADERS]]);
    await runReviewSync({ apply: true });
    const item = (await getReviewQueue()).find((q) => q.albumTitle === "Album Two")!;
    const r = await resolveReviewQueueItem({
      key: item.key, action: "keep_app", expected: { rmValue: item.rmValue, appSubmittedAt: item.app!.submittedAt }, actorEmail: KOHEI,
    });
    expect(r).toEqual({ ok: true });
    expect(db.sheets.get("rm/Release Master")![2][7]).toBe("8 アプリで更新");
    const journal = db.sheets.get("rm/_review_edit_log")!;
    expect(journal.at(-1)!.slice(3, 6)).toEqual(["efgh5678", KOHEI, JSON.stringify("8 アプリで更新")]);
    expect((await getReviewQueue()).map((q) => q.albumTitle)).toEqual(["Album One"]);
    // 書き戻した内容は次の同期で一致として扱われる
    const again = await runReviewSync({ apply: true });
    expect(again.reviewByReason.time_unknown).toBe(1);
  });

  it("表示した後にシートが変わっていたら解消しない", async () => {
    await runReviewSync({ apply: true });
    const item = (await getReviewQueue())[0];
    db.sheets.get("rm/Release Master")![1][7] = "10 さらに直した";
    const r = await resolveReviewQueueItem({
      key: item.key, action: "adopt_rm", expected: { rmValue: item.rmValue, appSubmittedAt: item.app!.submittedAt }, actorEmail: KOHEI,
    });
    expect(r.ok).toBe(false);
  });
});
