/**
 * M/J担当の未執筆アラート。
 *
 * ASSIGN が自分で、まだ掲載前（採用 / J採用）、かつ文章が書けていない作品を
 * MONTHLY と JAPAN に分けて1件ずつ知らせる。判定はマイページの M/J タブのバッジと同じ
 * （components/mypage/utils.ts の getAssignInfo / hasMjText）。
 */

import type { ReleaseMasterAlbum } from "@/lib/types";
import { getAssignInfo, hasMjText, mjTypeOf } from "@/components/mypage/utils";
import type { AlertDraft, AlertRule } from "./types";

const NOT_POSTED = ["採用", "J採用"];
const TITLE_PREVIEW = 3;

export function mjUnwrittenAlerts(albums: ReleaseMasterAlbum[], email: string): AlertDraft[] {
  const pending = albums.filter((a) =>
    NOT_POSTED.includes(a.mjAdoption ?? "") && getAssignInfo(a, email)?.isMe && !hasMjText(a)
  );

  return (["monthly", "japan"] as const).flatMap((type) => {
    const list = pending.filter((a) => mjTypeOf(a) === type).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    if (list.length === 0) return [];
    const names = list.slice(0, TITLE_PREVIEW).map((a) => `${a.artist}『${a.title}』`).join("、");
    const rest = list.length > TITLE_PREVIEW ? ` ほか${list.length - TITLE_PREVIEW}件` : "";
    return [{
      key: type,
      title: `${type === "monthly" ? "MONTHLY" : "JAPAN"} の未執筆が${list.length}件あります`,
      body: names + rest,
      url: `/mypage?tab=mj&mjType=${type}&assigned=1`,
    }];
  });
}

export const mjUnwrittenRule: AlertRule = {
  kind: "mj_unwritten",
  compute: async (ctx) => mjUnwrittenAlerts(await ctx.albums(), ctx.email),
};
