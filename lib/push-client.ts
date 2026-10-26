/**
 * ブラウザ側のプッシュ通知の登録（設定画面とベルから使う）。
 *
 * 流れ: Service Worker（/sw.js）を登録 → 通知の許可をもらう → PushManager で購読 →
 * 購読情報を /api/push/subscription に送る。サーバーはそれを使って lib/notifications/send.ts から送る。
 */

export type PushSupport =
  | "supported"
  | "unsupported"     // このブラウザは Web Push を扱えない
  | "needs-install";  // iPhone / iPad の Safari。ホーム画面に追加したアプリからなら使える

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "supported";
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** この端末の購読（無ければ null）。Service Worker 未登録なら登録はしない */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (detectPushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function saveToServer(sub: PushSubscription): Promise<void> {
  const res = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "端末を登録できませんでした");
}

/**
 * この端末で通知を受け取れるようにする。ボタンのタップから呼ぶこと
 * （iPhone はユーザー操作の中でしか通知の許可を聞けない）。
 */
export async function enablePush(): Promise<void> {
  if (detectPushSupport() !== "supported") throw new Error("この端末のブラウザでは通知を受け取れません");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "通知がブロックされています。端末やブラウザの設定から、このサイトの通知を許可してください"
      : "通知の許可がされませんでした");
  }

  const configRes = await fetch("/api/push/subscription");
  const config = await configRes.json().catch(() => ({})) as { publicKey?: string | null; error?: string };
  if (!configRes.ok) throw new Error(config.error ?? "通知の設定を取得できませんでした");
  if (!config.publicKey) throw new Error("サーバーに通知の鍵（VAPID）が設定されていません");

  const reg = await registration();
  const key = base64UrlToUint8Array(config.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // 鍵を入れ替えた後の古い購読は使えないので作り直す
  const existingKey = sub?.options.applicationServerKey;
  if (sub && existingKey && !sameBytes(new Uint8Array(existingKey), key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveToServer(sub);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** この端末の通知を止める（サーバーの登録も消す） */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

/**
 * 既に許可済みの端末で、サーバー側の登録を最新に保つ（画面を開いたときに呼ぶ）。
 * 別のメンバーで同じ端末にログインし直した場合も、ここで持ち主が切り替わる。
 */
export async function syncPushSubscription(): Promise<void> {
  if (notificationPermission() !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await saveToServer(sub).catch(() => {});
}
