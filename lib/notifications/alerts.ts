import "server-only";
import { getReleaseMasterAlbums } from "@/lib/release-master-albums";
import type { InboxItem, NotificationPrefs } from "./kinds";
import { ALERT_RULES } from "./rules";
import type { AlertContext } from "./rules/types";

/** 遅延読み込みを1回にまとめる */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= load());
}

/**
 * その人の今のアラートを計算する。ベル一覧への表示を OFF にしている種類は計算しない。
 * 1つのルールが失敗しても他のアラートは返す。
 */
export async function computeAlerts(email: string, prefs: NotificationPrefs, now = new Date()): Promise<InboxItem[]> {
  const ctx: AlertContext = { email: email.trim().toLowerCase(), now, albums: once(getReleaseMasterAlbums) };
  const createdAt = now.toISOString();

  const results = await Promise.all(
    ALERT_RULES.filter((rule) => prefs[rule.kind]?.inApp).map(async (rule) => {
      try {
        return (await rule.compute(ctx)).map((d): InboxItem => ({
          id: `alert:${rule.kind}:${d.key}`, kind: rule.kind, source: "alert",
          title: d.title, body: d.body, url: d.url, createdAt, readAt: null,
        }));
      } catch (e) {
        console.error(`[notifications] alert rule ${rule.kind} failed`, e);
        return [];
      }
    })
  );
  return results.flat();
}
