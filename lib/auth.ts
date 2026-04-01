import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const allowed = process.env.ALLOWED_MEMBER_EMAILS?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
      if (allowed.length === 0) return true;
      return allowed.includes(user.email ?? "");
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
};
