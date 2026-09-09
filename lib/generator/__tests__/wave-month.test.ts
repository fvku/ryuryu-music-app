import { describe, expect, it } from "vitest";
import { pickWaveMonth, waveMonthLabel, waveMonthWarning } from "@/app/generator/wave-month";

const available = ["2026-01", "2026-08", "2026-09", "2026-12"];

describe("pickWaveMonth", () => {
  it("対象月が登録されていればそれを使い、exactになる", () => {
    expect(pickWaveMonth(available, "2026-09")).toEqual({ month: "2026-09", requested: "2026-09", exact: true });
  });

  it("未登録の月は直近の登録済みの月で代替し、exactにしない", () => {
    // 2027-01は未登録 → 2026-12。年をまたいでも文字列比較で正しく並ぶ
    expect(pickWaveMonth(available, "2027-01")).toEqual({ month: "2026-12", requested: "2027-01", exact: false });
    expect(pickWaveMonth(available, "2026-10")).toEqual({ month: "2026-09", requested: "2026-10", exact: false });
  });

  it("登録済みのどれよりも前の月は、いちばん古い月で代替する", () => {
    expect(pickWaveMonth(available, "2025-11")).toEqual({ month: "2026-01", requested: "2025-11", exact: false });
  });

  it("1枚も登録が無ければ対象月のまま返し、exactにしない（呼び出し側が警告を出す）", () => {
    expect(pickWaveMonth([], "2026-09")).toEqual({ month: "2026-09", requested: "2026-09", exact: false });
  });

  it("並び順が崩れた一覧でも直近の月を選べる", () => {
    expect(pickWaveMonth(["2026-12", "2026-01", "2026-09"], "2026-11").month).toBe("2026-09");
  });
});

describe("waveMonthWarning", () => {
  it("対象月がそろっていれば警告を出さない", () => {
    expect(waveMonthWarning(pickWaveMonth(available, "2026-09"))).toEqual([]);
    expect(waveMonthWarning(null)).toEqual([]);
  });

  it("代替で描いている場合は、対象月と実際に使った月の両方を挙げて止める", () => {
    const [warning] = waveMonthWarning(pickWaveMonth(available, "2027-01"));
    expect(warning).toContain("2027年1月");
    expect(warning).toContain("2026年12月");
    expect(warning).toContain("書き出せません");
  });
});

describe("waveMonthLabel", () => {
  it("先頭の0を落とした日本語表記にする", () => {
    expect(waveMonthLabel("2026-01")).toBe("2026年1月");
    expect(waveMonthLabel("2026-12")).toBe("2026年12月");
  });
});
