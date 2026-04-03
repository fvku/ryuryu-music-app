import type { Metadata, Viewport } from "next";
import "./globals.css";
import Image from "next/image";
import Providers from "@/components/Providers";
import BottomNav from "@/components/BottomNav";
import HowToUseModal from "@/components/HowToUseModal";

export const metadata: Metadata = {
  title: "月次アルバムレビュー",
  description: "グループメンバーによる月次アルバムレビューサイト",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      { rel: "icon", url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
            <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between">
              <div className="w-16" />
              <a href="/" className="hover:opacity-80 transition-opacity">
                <Image src="/logo.png" alt="流流" width={180} height={48} className="h-11 w-auto object-contain my-0" />
              </a>
              <div className="w-16 flex justify-end">
                <HowToUseModal />
              </div>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-8 pb-36">
            {children}
          </main>

          <footer
            className="mt-16 border-t py-8 pb-40 text-center text-sm"
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
