import type { MetadataRoute } from "next";

/**
 * ホーム画面アプリとしての設定。iPhone はホーム画面に追加したアプリでないと
 * Web Push を受け取れない（iOS 16.4〜）ので、display: standalone が必要。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "流流 月次アルバムレビュー",
    short_name: "流流",
    description: "グループメンバーによる月次アルバムレビューサイト",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f0f13",
    theme_color: "#0f0f13",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
