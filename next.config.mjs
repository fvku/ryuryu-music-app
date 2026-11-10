/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // SpotifyのループバックURIと、Cookieを保存するブラウザのホストを揃える。
    // 開発用の明示的なループバック設定がある場合だけ、古いlocalhostタブを移す。
    if (process.env.NODE_ENV !== "development") return [];
    let authUrl;
    try {
      authUrl = new URL(process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://127.0.0.1:3000");
    } catch {
      return [];
    }
    if (authUrl.protocol !== "http:" || authUrl.hostname !== "127.0.0.1") return [];
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "localhost" }],
      destination: `${authUrl.origin}/:path*`,
      permanent: false,
    }];
  },
  // 画面に埋め込む自分の版。components/UpdateBanner.tsx が /api/version と比べて更新を知らせる（ローカルでは空）
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
  // ジェネレーターの並べ替えでアーティスト名の読みを推定する辞書（lib/generator/artist-reading.ts）。
  // 辞書ファイルは実行時にパスで読むので、バンドルせず、Vercelの関数へ明示的に同梱する。
  serverExternalPackages: ["kuromoji"],
  outputFileTracingIncludes: {
    "/api/generator/**/*": ["./node_modules/kuromoji/dict/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.scdn.co",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "mosaic.scdn.co",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.gyazo.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "gyazo.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "drive.google.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.imgur.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.imgur.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.mzstatic.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.discogs.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.last.fm",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
