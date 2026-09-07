"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isImmersiveRoute } from "@/lib/app-chrome";

/**
 * 本文と共通フッター。ジェネレーターの編集画面だけ、フッターと下余白を外して
 * 縦をプレビューへ回す。ほかの画面の見え方は変えない。
 */
export default function AppFrame({ children }: { children: React.ReactNode }) {
  const immersive = isImmersiveRoute(usePathname());

  return (
    <>
      <main className={`max-w-6xl mx-auto px-4 ${immersive ? "py-4" : "py-8 pb-36"}`}>
        {children}
      </main>

      {!immersive && (
        <footer
          className="mt-16 border-t py-8 pb-40 text-center text-sm"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <p>
            <Link href="/generator" className="hover:text-white transition-colors underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>
              投稿画像ジェネレーター
            </Link>
            <span className="mx-2">·</span>
            <Link href="/admin" className="hover:text-white transition-colors underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>
              管理者
            </Link>
          </p>
          <p className="mt-2">© 月次アルバムレビュー</p>
        </footer>
      )}
    </>
  );
}
