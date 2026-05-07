import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import SpotifyProvider from "next-auth/providers/spotify";

const SPOTIFY_SCOPES = "streaming user-read-email user-read-private";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: `https://accounts.spotify.com/authorize?scope=${encodeURIComponent(SPOTIFY_SCOPES)}`,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const allowed = process.env.ALLOWED_MEMBER_EMAILS?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
      if (allowed.length === 0) return true;
      return allowed.includes(user.email ?? "");
    },
    async jwt({ token, account }) {
      if (account?.provider === "spotify" && account.access_token) {
        token.spotifyAccessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.spotifyAccessToken) {
        (session as unknown as Record<string, unknown>).spotifyAccessToken = token.spotifyAccessToken;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
};
