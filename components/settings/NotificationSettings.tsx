"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationPrefs } from "@/lib/notifications/kinds";
import {
  currentSubscription, detectPushSupport, disablePush, enablePush, notificationPermission, type PushSupport,
} from "@/lib/push-client";

const CONFIGURABLE = (NOTIFICATION_KINDS as readonly NotificationKind[]).filter((k) => k.configurable);

/** 設定画面の「通知」カード：この端末のプッシュ ON/OFF、テスト送信、種類ごとの受け取り設定 */
export default function NotificationSettings() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState<"enable" | "disable" | "test" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    // 端末判定はブラウザでしかできないので、描画後に行う
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(detectPushSupport());
    setBlocked(notificationPermission() === "denied");
    currentSubscription().then((s) => setSubscribed(!!s && notificationPermission() === "granted")).catch(() => {});
    fetch("/api/notifications/prefs").then((r) => (r.ok ? r.json() : null)).then((d) => d && setPrefs(d.prefs)).catch(() => {});
  }, []);

  async function run(kind: "enable" | "disable" | "test", action: () => Promise<string>) {
    setBusy(kind);
    setMessage(null);
    try {
      setMessage({ text: await action(), error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "うまくいきませんでした", error: true });
    } finally {
      setBusy(null);
      setBlocked(notificationPermission() === "denied");
    }
  }

  const handleEnable = () => run("enable", async () => {
    await enablePush();
    setSubscribed(true);
    return "この端末で通知を受け取れるようになりました";
  });

  const handleDisable = () => run("disable", async () => {
    await disablePush();
    setSubscribed(false);
    return "この端末の通知を止めました";
  });

  const handleTest = () => run("test", async () => {
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "テスト通知を送れませんでした");
    const push = data.push as { attempted: number; delivered: number; skipped?: string };
    if (push.skipped === "not_configured") return "ベル一覧に送りました（サーバーにプッシュの鍵が未設定のため、端末には届きません）";
    if (push.attempted === 0) return "ベル一覧に送りました（通知を受け取る端末がまだ登録されていません）";
    return `${push.delivered}台の端末に送りました（登録 ${push.attempted}台）`;
  });

  async function updatePref(id: string, field: "inApp" | "push", value: boolean) {
    if (!prefs) return;
    const next = { ...prefs[id], [field]: value };
    setPrefs({ ...prefs, [id]: next });
    const res = await fetch("/api/notifications/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: { [id]: next } }),
    }).catch(() => null);
    if (res?.ok) setPrefs((await res.json()).prefs);
    else {
      setPrefs(prefs);
      setMessage({ text: "設定を保存できませんでした", error: true });
    }
  }

  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
      <h2 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>通知</h2>

      {/* この端末のプッシュ通知 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>この端末で受け取る</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {support === "needs-install" && "iPhone・iPad はホーム画面に追加したアプリから開くと設定できます（Safariの共有ボタン →「ホーム画面に追加」）"}
            {support === "unsupported" && "このブラウザはプッシュ通知に対応していません"}
            {support === "supported" && (blocked
              ? "通知がブロックされています。端末やブラウザの設定から、このサイトの通知を許可してください"
              : subscribed ? "アプリを閉じていても通知が届きます" : "オンにすると、アプリを閉じていても通知が届きます")}
          </p>
        </div>
        {support === "supported" && (
          <span className="text-xs px-2 py-1 rounded-full flex-shrink-0"
            style={subscribed
              ? { backgroundColor: "rgba(34,197,94,0.12)", color: "#22c55e" }
              : { backgroundColor: "rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}>
            {subscribed ? "オン" : "オフ"}
          </span>
        )}
      </div>

      {support === "supported" && (
        <div className="flex gap-2 mb-2">
          {subscribed ? (
            <button
              onClick={handleDisable}
              disabled={!!busy}
              className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              オフにする
            </button>
          ) : (
            <button
              onClick={handleEnable}
              disabled={!!busy || blocked}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {busy === "enable" ? "設定中..." : "オンにする"}
            </button>
          )}
        </div>
      )}

      <button
        onClick={handleTest}
        disabled={!!busy}
        className="w-full py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70 disabled:opacity-50"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
      >
        {busy === "test" ? "送信中..." : "自分にテスト通知を送る"}
      </button>

      {message && (
        <p className="text-xs mt-3" style={{ color: message.error ? "#ef4444" : "#22c55e" }}>{message.text}</p>
      )}

      {/* 種類ごとの受け取り設定 */}
      {CONFIGURABLE.length > 0 && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-[11px] font-bold mb-3" style={{ color: "var(--text-secondary)" }}>受け取る内容</p>
          <ul className="flex flex-col gap-4">
            {CONFIGURABLE.map((kind) => (
              <li key={kind.id}>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{kind.label}</p>
                <p className="text-xs mt-0.5 mb-2" style={{ color: "var(--text-secondary)" }}>{kind.description}</p>
                <div className="flex gap-2 flex-wrap">
                  <Toggle label="ベル一覧" value={prefs?.[kind.id]?.inApp} onChange={(v) => updatePref(kind.id, "inApp", v)} />
                  {kind.pushAvailable && (
                    <Toggle label="プッシュ" value={prefs?.[kind.id]?.push} onChange={(v) => updatePref(kind.id, "push", v)} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  const on = value === true;
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={value === undefined}
      aria-pressed={on}
      className="px-3 py-1 rounded-full border text-xs font-bold transition-colors disabled:opacity-40"
      style={{
        backgroundColor: on ? "rgba(139,92,246,0.18)" : "var(--bg-card)",
        color: on ? "#a78bfa" : "var(--text-secondary)",
        borderColor: on ? "var(--border-accent)" : "var(--border-subtle)",
      }}
    >
      {label}：{on ? "オン" : "オフ"}
    </button>
  );
}
