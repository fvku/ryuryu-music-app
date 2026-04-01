/** @type {import('next').NextConfig} */
const nextConfig = {
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
