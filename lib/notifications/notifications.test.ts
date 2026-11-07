import { describe, it, expect } from "vitest";
import { mjUnwrittenAlerts } from "@/lib/notifications/rules/mj-unwritten";
import { NOTIFICATION_KINDS, resolvePrefs } from "@/lib/notifications/kinds";
import { ALERT_RULES } from "@/lib/notifications/rules";
import { ReleaseMasterAlbum } from "@/lib/types";

const KOHEI = "kohei.fuku0926@gmail.com";
const LONG_TEXT = "あ".repeat(80);

function album(overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum {
  return {
    no: "1", uid: "", date: "2026/10/01", title: "Title", artist: "Artist", genre: "洋楽", duration: "", weekNumber: "",
    genreMemo: "", playlistMemo: "", country: "", weekAdoption: "", mjAdoption: "採用", mjAssign: "Kohei",
    mjTrackNo: "", mjTrack: "", mjStartTime: "", mjText: "", legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "",
    ...overrides,
  };
}

describe("mjUnwrittenAlerts", () => {
  it("自分の担当で未執筆の作品を MONTHLY / JAPAN に分けて数える", () => {
    const alerts = mjUnwrittenAlerts([
      album({ title: "A" }),
      album({ title: "B", date: "2026/09/30" }),
      album({ title: "C", mjAdoption: "J採用" }),
    ], KOHEI);
    expect(alerts.map((a) => [a.key, a.title])).toEqual([
      ["monthly", "MONTHLY の未執筆が2件あります"],
      ["japan", "JAPAN の未執筆が1件あります"],
    ]);
    // 日付の古い順に並べる
    expect(alerts[0].body).toBe("Artist『B』、Artist『A』");
    expect(alerts[1].url).toBe("/mypage?tab=mj&mjType=japan&assigned=1");
  });

  it("他人の担当・寄稿者・書き終えた作品・掲載済みは数えない", () => {
    const alerts = mjUnwrittenAlerts([
      album({ mjAssign: "Meri" }),
      album({ mjAssign: "寄稿者" }),
      album({ mjTrack: "1. Song", mjText: LONG_TEXT }),
      album({ mjAdoption: "掲載" }),
      album({ mjAdoption: "検討" }),
    ], KOHEI);
    expect(alerts).toEqual([]);
  });

  it("曲だけ選んで文章が短いものはまだ未執筆として数える", () => {
    expect(mjUnwrittenAlerts([album({ mjTrack: "1. Song", mjText: "短い" })], KOHEI)).toHaveLength(1);
  });

  it("4件以上は先頭3件の作品名と残りの件数にまとめる", () => {
    const albums = ["A", "B", "C", "D", "E"].map((title, i) => album({ title, date: `2026/10/0${i + 1}` }));
    expect(mjUnwrittenAlerts(albums, KOHEI)[0].body).toBe("Artist『A』、Artist『B』、Artist『C』 ほか2件");
  });
});

describe("resolvePrefs", () => {
  it("未保存の種類は既定値で埋める", () => {
    const prefs = resolvePrefs({});
    expect(prefs.test).toEqual({ inApp: true, push: true });
    expect(prefs.mj_unwritten).toEqual({ inApp: true, push: false });
  });

  it("保存値を優先するが、プッシュ非対応の種類は常にプッシュ OFF", () => {
    const prefs = resolvePrefs({ mj_unwritten: { inApp: false, push: true } });
    expect(prefs.mj_unwritten).toEqual({ inApp: false, push: false });
  });
});

describe("種類とルールの対応", () => {
  it("alert の種類にはルールが1つずつあり、ルールは alert の種類だけを指す", () => {
    const alertKinds = NOTIFICATION_KINDS.filter((k) => k.source === "alert").map((k) => k.id).sort();
    expect(ALERT_RULES.map((r) => r.kind).sort()).toEqual(alertKinds);
  });
});
