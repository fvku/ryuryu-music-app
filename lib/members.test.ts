import { describe, expect, it } from "vitest";
import { EMAIL_TO_SHORT_NAME, MEMBER_SHORT_NAMES, SHORT_NAME_TO_EMAIL } from "./members";
import { ASSIGN_VALUES } from "@/components/mj-writing-modal/utils";

describe("メンバー定義", () => {
  it("スコア列の一覧はメールの対応表と同じ6人（Kaedeを含む）", () => {
    expect([...MEMBER_SHORT_NAMES].sort()).toEqual(Object.values(EMAIL_TO_SHORT_NAME).sort());
    expect(MEMBER_SHORT_NAMES).toContain("Kaede");
  });

  it("短縮名からメールを引ける", () => {
    for (const name of MEMBER_SHORT_NAMES) expect(EMAIL_TO_SHORT_NAME[SHORT_NAME_TO_EMAIL[name]]).toBe(name);
  });

  it("ASSIGNの候補にも全員が入る", () => {
    for (const name of MEMBER_SHORT_NAMES) expect(ASSIGN_VALUES).toContain(name);
  });
});
