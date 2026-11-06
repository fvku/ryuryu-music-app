/**
 * メンバーへ通知を送る。どこから送るとき（Cron・書き込み処理・設定画面のテスト）も、ここの
 * `notifyMember` を呼ぶ。
 *
 *   1. ベル一覧への表示が ON なら notifications シートに残す（既読管理のため）
 *   2. プッシュが ON なら、その人の登録端末すべてへ Web Push で送る
 *
 * プッシュの鍵は VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT（環境変数）。
 * 未設定ならプッシュだけ飛ばし、ベル一覧には残す。
 * 端末側で登録が切れている（404 / 410）ものは、その場で登録を消す。
 */

import "server-only";
import { randomUUID } from "crypto";
import webpush from "web-push";
import { getNotificationKind, resolvePrefs, type NotificationKindId } from "./kinds";
import {
  appendNotification, markSubscriptionsSent, readSavedPrefs, readSubscriptions, removeSubscriptions,
} from "./store";

export interface NotifyInput {
  kind: NotificationKindId;
  title: string;
  body: string;
  /** タップしたときの移動先（アプリ内のパス）。既定はホーム */
  url?: string;
}

export interface NotifyResult {
  id: string;
  stored: boolean;
  /** 送ろうとした端末数 / 届いた端末数 / 登録切れで消した端末数 */
  push: { attempted: number; delivered: number; removed: number; skipped?: "disabled" | "not_configured" };
}

/** Service Worker（public/sw.js）が受け取る中身 */
export interface PushPayload {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
}

let vapidReady: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:kohei.fuku0926@gmail.com";
  vapidReady = !!(publicKey && privateKey);
  if (vapidReady) webpush.setVapidDetails(subject, publicKey!, privateKey!);
  return vapidReady;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export async function notifyMember(email: string, input: NotifyInput): Promise<NotifyResult> {
  const kind = getNotificationKind(input.kind);
  if (!kind || kind.source !== "message") throw new Error(`unknown message kind: ${input.kind}`);

  const pref = resolvePrefs(await readSavedPrefs(email))[input.kind];
  const id = randomUUID();
  const url = input.url?.startsWith("/") ? input.url : "/";
  const createdAt = new Date().toISOString();

  if (pref.inApp) {
    await appendNotification({ id, email, kind: input.kind, title: input.title, body: input.body, url, createdAt, readAt: null });
  }

  if (!pref.push) return { id, stored: pref.inApp, push: { attempted: 0, delivered: 0, removed: 0, skipped: "disabled" } };
  if (!ensureVapid()) return { id, stored: pref.inApp, push: { attempted: 0, delivered: 0, removed: 0, skipped: "not_configured" } };

  const subscriptions = await readSubscriptions(email);
  const payload: PushPayload = { id, kind: input.kind, title: input.title, body: input.body, url };
  const body = JSON.stringify(payload);

  const results = await Promise.all(subscriptions.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 * 24, urgency: "normal" },
      );
      return { endpoint: s.endpoint, ok: true, gone: false };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status !== 404 && status !== 410) console.error(`[notifications] push failed status=${status ?? "?"}`, e);
      return { endpoint: s.endpoint, ok: false, gone: status === 404 || status === 410 };
    }
  }));

  const delivered = results.filter((r) => r.ok).map((r) => r.endpoint);
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
  await removeSubscriptions(gone);
  await markSubscriptionsSent(delivered, createdAt);

  return { id, stored: pref.inApp, push: { attempted: subscriptions.length, delivered: delivered.length, removed: gone.length } };
}
