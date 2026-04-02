import type { Metadata, Viewport } from "next";
import "./globals.css";
import Image from "next/image";
import Providers from "@/components/Providers";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "月次アルバムレビュー",
  description: "グループメンバーによる月次アルバムレビューサイト",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen" style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-primary)" }}>
        <Providers>
          <header
            className="sticky top-0 z-50 border-b"
            style={{
              backgroundColor: "rgba(15, 15, 19, 0.85)",
              backdropFilter: "blur(12px)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-center">
              <a href="/" className="hover:opacity-80 transition-opacity">
                <Image src="/logo.png" alt="流流" width={120} height={40} className="h-8 w-auto object-contain" />
              </a>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-8 pb-24">
            {children}
          </main>

          <footer
            className="mt-16 border-t py-8 pb-28 text-center text-sm"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            <p>
              <a href="/admin" className="hover:text-white transition-colors underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>
                管理者
              </a>
            </p>
            <p className="mt-2">© 月次アルバムレビュー</p>
          </footer>

          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
