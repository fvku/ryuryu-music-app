"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { InboxItem, InboxResponse } from "@/lib/notifications/kinds";
import { syncPushSubscription } from "@/lib/push-client";

/**
 * ヘッダーのベルと「お知らせ」一覧。
 * 中身は /api/notifications（今のアラート＋送られた通知）。開いた時点で通知は既読にするが、
 * 開いている間は未読の印を残す（何が新しかったか分かるように）。
 */
export default function NotificationBell() {
  const { data: session } = useSession();
  const router = useRouter();
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [open, setOpen] = useState(false);
  /** 開いた時点で未読だった通知。開いている間だけ未読の印を付ける */
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState(false);
  const loggedIn = !!session?.user?.email;

  const load = useCallback(() => fetchInbox().then((data) => {
    if (data) setInbox(data);
    setLoadError(!data);
  }), []);

  // ログイン時・前面復帰時・プッシュ受信時に読み直す
  useEffect(() => {
    if (!loggedIn) return;
    load();
    syncPushSubscription();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loggedIn, load]);

  useEffect(() => {
    if (!loggedIn || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "ryuryu:notification") load();
      if (e.data?.type === "ryuryu:open" && typeof e.data.url === "string") router.push(e.data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [loggedIn, load, router]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!loggedIn) return null;

  const items = inbox?.items ?? [];
  const alerts = items.filter((i) => i.source === "alert");
  const messages = items.filter((i) => i.source === "message");
  const badge = inbox?.badgeCount ?? 0;

  async function handleOpen() {
    setOpen(true);
    const unread = messages.filter((m) => !m.readAt).map((m) => m.id);
    setHighlightIds(new Set(unread));
    // 既読にしてから読み直す（先に読み直すと既読前の件数でバッジが戻る）
    if (unread.length > 0) {
      await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    }
    load();
  }

  function handleClose() {
    setOpen(false);
    setHighlightIds(new Set());
  }

  function handleSelect(item: InboxItem) {
    handleClose();
    if (item.url) router.push(item.url);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="relative w-9 h-9 rounded-[10px] flex items-center justify-center transition-opacity hover:opacity-70"
        style={{ background: "rgba(255,255,255,0.07)" }}
        aria-label={badge > 0 ? `お知らせ（${badge}件）` : "お知らせ"}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {badge > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ backgroundColor: "#ef4444", color: "white" }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div
            className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
            role="dialog"
            aria-label="お知らせ"
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
              style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
            >
              <div className="w-10 h-10" />
              <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
              <h2 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>お知らせ</h2>
              <button
                onClick={handleClose}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-lg font-medium"
                style={{ color: "var(--text-secondary)" }}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="px-4 py-4 flex flex-col gap-5">
              {loadError && !inbox && (
                <p className="text-xs text-center py-6" style={{ color: "#ef4444" }}>お知らせを読み込めませんでした</p>
              )}
              {!inbox && !loadError && (
                <p className="text-xs text-center py-6" style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
              )}

              {alerts.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold mb-2 px-1" style={{ color: "var(--text-secondary)" }}>やること</h3>
                  <ul className="flex flex-col gap-2">
                    {alerts.map((item) => <Row key={item.id} item={item} unread={false} onSelect={handleSelect} />)}
                  </ul>
                </section>
              )}

              {messages.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold mb-2 px-1" style={{ color: "var(--text-secondary)" }}>通知</h3>
                  <ul className="flex flex-col gap-2">
                    {messages.map((item) => <Row key={item.id} item={item} unread={highlightIds.has(item.id) || !item.readAt} onSelect={handleSelect} />)}
                  </ul>
                </section>
              )}

              {inbox && items.length === 0 && (
                <div className="text-center py-10">
                  <p className="text-3xl mb-3">🔔</p>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>お知らせはありません</p>
                </div>
              )}

              <Link
                href="/settings"
                onClick={handleClose}
                className="text-xs text-center py-2 hover:opacity-70"
                style={{ color: "var(--text-secondary)" }}
              >
                通知の設定
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

async function fetchInbox(): Promise<InboxResponse | null> {
  try {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function Row({ item, unread, onSelect }: { item: InboxItem; unread: boolean; onSelect: (item: InboxItem) => void }) {
  const isAlert = item.source === "alert";
  return (
    <li>
      <button
        onClick={() => onSelect(item)}
        className="w-full text-left rounded-xl border px-4 py-3 flex gap-3 transition-colors hover:bg-white/5"
        style={{
          backgroundColor: "var(--bg-card)",
          borderColor: isAlert ? "rgba(251,191,36,0.35)" : unread ? "var(--border-accent)" : "var(--border-subtle)",
        }}
      >
        <span
          className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: isAlert ? "#fbbf24" : unread ? "var(--accent)" : "transparent" }}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold" style={{ color: "var(--text-primary)" }}>{item.title}</span>
          {item.body && (
            <span className="block text-xs mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{item.body}</span>
          )}
          {!isAlert && (
            <span className="block text-[10px] mt-1.5" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
              {formatTime(item.createdAt)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`;
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
