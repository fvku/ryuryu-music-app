/*
 * 通知専用の Service Worker（lib/push-client.ts が登録する）。
 *
 * 画面やAPIのキャッシュは一切しない（fetch を扱わない）。キャッシュを持つと
 * 新しいデプロイが届かなくなり、components/UpdateBanner.tsx の前提が崩れるため。
 * やることは「プッシュを受けて表示する」「タップでアプリを開く」の2つだけ。
 *
 * 受け取る中身は lib/notifications/send.ts の PushPayload（id, kind, title, body, url）。
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "流流";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";

  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.id || undefined,
      data: { url, id: data.id || null },
    });
    // 開いている画面のベルを更新させる
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) w.postMessage({ type: "ryuryu:notification", id: data.id || null });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = windows.find((w) => new URL(w.url).origin === target.origin);
    if (same) {
      await same.focus();
      // navigate は Service Worker の管理下にある画面でしか効かないので、だめなら画面側に移動を頼む
      const moved = "navigate" in same ? await same.navigate(target.href).then(() => true, () => false) : false;
      if (!moved) same.postMessage({ type: "ryuryu:open", url: target.pathname + target.search });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
