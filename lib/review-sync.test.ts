import { describe, expect, it } from "vitest";
import { appJournalRow, decideReviewSync, formatReviewCell, JournalEntry, parseJournalRow, parseReviewCell } from "./review-sync";

const j = (recordedAt: string, value: string, status = "recorded"): JournalEntry => ({
  recordedAt, albumUid: "abcd1234", memberEmail: "kohei.fuku0926@gmail.com", value, captureKind: "single_event", status,
});

describe("parseReviewCell / formatReviewCell", () => {
  it("スコア・スコア＋コメント・コメントだけを読み分ける", () => {
    expect(parseReviewCell("7.5 最高")).toEqual({ score: 7.5, comment: "最高" });
    expect(parseReviewCell("8")).toEqual({ score: 8, comment: "" });
    expect(parseReviewCell("great album")).toEqual({ score: null, comment: "great album" });
    expect(parseReviewCell("")).toEqual({ score: null, comment: "" });
    expect(parseReviewCell("0")).toEqual({ score: 0, comment: "" });
  });
  it("範囲外のスコアは誤入力として null", () => {
    expect(parseReviewCell("12 typo")).toBeNull();
    expect(parseReviewCell("90sきいて育った")).toBeNull();
  });
  it("スコアの取り出しは平均点の計算と同じ読み方（既存データと食い違わせない）", () => {
    expect(parseReviewCell("7+ かっこいいね")).toEqual({ score: 7, comment: "かっこいいね" });
    expect(parseReviewCell("6.5曲単位では良い")).toEqual({ score: 6.5, comment: "" });
    expect(parseReviewCell("It's fine")).toEqual({ score: null, comment: "It's fine" });
  });
  it("スコアなしはコメントだけを書く", () => {
    expect(formatReviewCell(null, "一言")).toBe("一言");
    expect(formatReviewCell(7, "")).toBe("7");
    expect(formatReviewCell(7.5, "良い")).toBe("7.5 良い");
  });
});

describe("decideReviewSync", () => {
  const app = { score: 8, comment: "アプリで更新", submittedAt: "2026-11-10T10:00:00.000Z" };

  it("同じ内容なら何もしない", () => {
    expect(decideReviewSync("8 アプリで更新", app, [])).toEqual({ action: "none" });
  });

  it("履歴の無い差分は時刻不明として確認待ち（検出時刻で上書きしない）", () => {
    expect(decideReviewSync("6 古い内容", app, [])).toEqual({ action: "review", reason: "time_unknown", rmRecordedAt: null });
  });

  it("アプリの方が新しければアプリを戻さず、反映漏れとして確認待ち", () => {
    const d = decideReviewSync("6 古い内容", app, [j("2026-11-09T10:00:00.000Z", "6 古い内容")]);
    expect(d).toEqual({ action: "review", reason: "app_newer", rmRecordedAt: "2026-11-09T10:00:00.000Z" });
  });

  it("Release Master の方が新しければ、その記録時刻でアプリへ反映する", () => {
    const d = decideReviewSync("9 シートで直した", app, [j("2026-11-11T10:00:00.000Z", "9 シートで直した")]);
    expect(d).toEqual({ action: "apply_rm", review: { score: 9, comment: "シートで直した" }, submittedAt: "2026-11-11T10:00:00.000Z" });
  });

  it("アプリに無いレビューは、履歴があれば記録時刻で追加する", () => {
    const d = decideReviewSync("7", null, [j("2026-11-11T10:00:00.000Z", "7")]);
    expect(d).toEqual({ action: "apply_rm", review: { score: 7, comment: "" }, submittedAt: "2026-11-11T10:00:00.000Z" });
  });

  it("最新の履歴とセルが違う（APIなど履歴に残らない書き込み）なら時刻不明", () => {
    const d = decideReviewSync("5", null, [j("2026-11-11T10:00:00.000Z", "7")]);
    expect(d).toMatchObject({ action: "review", reason: "time_unknown" });
  });

  it("同時刻で内容が違えば両方を残して確認待ち", () => {
    const d = decideReviewSync("9", { ...app, submittedAt: "2026-11-11T10:00:00.000Z" }, [j("2026-11-11T10:00:00.000Z", "9")]);
    expect(d).toMatchObject({ action: "review", reason: "same_time_conflict" });
    const d2 = decideReviewSync("9", null, [j("2026-11-11T10:00:00.000Z", "9"), j("2026-11-11T10:00:00.000Z", "8")]);
    expect(d2).toMatchObject({ action: "review", reason: "same_time_conflict" });
  });

  it("一括貼り付けなど要確認の履歴は自動で反映しない", () => {
    const d = decideReviewSync("9", null, [j("2026-11-11T10:00:00.000Z", "9", "needs_review:range_snapshot")]);
    expect(d).toMatchObject({ action: "review", reason: "needs_review" });
  });

  it("0点は空欄と区別する", () => {
    const d = decideReviewSync("0", null, [j("2026-11-11T10:00:00.000Z", "0")]);
    expect(d).toEqual({ action: "apply_rm", review: { score: 0, comment: "" }, submittedAt: "2026-11-11T10:00:00.000Z" });
  });

  it("コメントだけのアプリレビューは Release Master が空でも正常", () => {
    expect(decideReviewSync("", { score: null, comment: "一言", submittedAt: app.submittedAt }, [])).toEqual({ action: "none" });
  });

  it("履歴の無いコメントだけのセルは、旧同期と同じく取り込まない", () => {
    expect(decideReviewSync("同じ", null, [])).toEqual({ action: "none" });
    expect(decideReviewSync("7", null, [])).toMatchObject({ action: "review", reason: "time_unknown" });
  });

  it("履歴の無い空セルは従来どおり何もしない", () => {
    expect(decideReviewSync("", app, [])).toEqual({ action: "none" });
  });

  it("アプリより後にシートで消したことが履歴で分かれば確認待ち", () => {
    const d = decideReviewSync("", app, [j("2026-11-11T10:00:00.000Z", "")]);
    expect(d).toMatchObject({ action: "review", reason: "rm_cleared" });
  });
});

describe("journal rows", () => {
  it("アプリの書き込み記録は Apps Script と同じ列で、読み戻せる", () => {
    const row = appJournalRow({
      operationId: "op1", recordedAt: "2026-11-11T10:00:00.000Z", albumUid: "abcd1234", memberEmail: "Kohei.Fuku0926@gmail.com",
      value: "8 良い", previous: "7", cellA1: "AA12", albumNo: "11", albumTitle: "T", artistName: "A",
    });
    expect(row).toHaveLength(14);
    expect(parseJournalRow(row)).toEqual({
      recordedAt: "2026-11-11T10:00:00.000Z", albumUid: "abcd1234", memberEmail: "kohei.fuku0926@gmail.com",
      value: "8 良い", captureKind: "app_write", status: "recorded",
    });
  });

  it("壊れた行は読まない", () => {
    expect(parseJournalRow(["1", "x", "2026-11-11T10:00:00.000Z", "abcd1234", "a@b", "{bad"])).toBeNull();
    expect(parseJournalRow(["2", "x", "2026-11-11T10:00:00.000Z", "abcd1234", "a@b", "\"7\""])).toBeNull();
  });
});
