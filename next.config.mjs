/** @type {import('next').NextConfig} */
const nextConfig = {
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
