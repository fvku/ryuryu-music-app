import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedMember } from "./member-access";
import { recordLoginIdentity } from "./auth-identity";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      return account?.provider === "google" && profile?.email_verified === true
        && profile.email === user.email && isAllowedMember(user.email);
    },
    async jwt({ token, account, profile }) {
      recordLoginIdentity(token, account, profile);
      return token;
    },
    async session({ session, token }) {
      session.loginProvider = token.loginProvider;
      session.googleVerifiedEmail = token.googleVerifiedEmail;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
