import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Spotify from "next-auth/providers/spotify";
import { isAllowedMember } from "./member-access";
import { recordLoginIdentity } from "./auth-identity";

const SPOTIFY_SCOPES =
  "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Spotify({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: `https://accounts.spotify.com/authorize?scope=${encodeURIComponent(SPOTIFY_SCOPES)}`,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return isAllowedMember(user.email);
    },
    async jwt({ token, account, profile }) {
      recordLoginIdentity(token, account, profile);
      if (account?.provider === "spotify" && account.access_token) {
        token.spotifyAccessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.loginProvider = token.loginProvider;
      session.googleVerifiedEmail = token.googleVerifiedEmail;
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
});
