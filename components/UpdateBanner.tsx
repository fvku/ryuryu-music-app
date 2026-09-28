"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isImmersiveRoute } from "@/lib/app-chrome";

// ビルド時に埋め込んだ、この画面自身の版（next.config.mjs の env）
const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/**
 * 新しいデプロイがあれば「再読み込み」を促すバナー。
 *
 * ホーム画面から開いたアプリには再読み込みボタンが無く、バックグラウンドから戻っても
 * 前回の画面がそのまま復元されるため、更新に気づけない。前面に戻ったときだけ
 * /api/version を確認する（定期ポーリングはしない）。
 * ジェネレーター編集中の作業を消さないよう、自動では再読み込みせずボタンを押してもらう。
 * ローカル開発では版が空なので何もしない。
 */
export default function UpdateBanner() {
  const immersive = isImmersiveRoute(usePathname());
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (!CLIENT_VERSION) return;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (version && version !== CLIENT_VERSION) setHasUpdate(true);
      } catch {
        // オフラインなどは次に前面へ戻ったときに再確認する
      }
    };

    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  if (!hasUpdate) return null;

  return (
    <div
      className="fixed left-0 right-0 z-50 px-4 flex justify-center pointer-events-none"
      // 下部ナビ（高さ約80px）の上に出す。ナビを出さない画面では画面下端から
      style={{ bottom: `calc(${immersive ? 16 : 88}px + env(safe-area-inset-bottom))` }}
    >
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm"
        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
      >
        <span>新しいバージョンがあります</span>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg px-3 py-1.5 font-medium text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}
