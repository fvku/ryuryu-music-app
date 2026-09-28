"use client";

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
          <p>© 月次アルバムレビュー</p>
        </footer>
      )}
    </>
  );
}
