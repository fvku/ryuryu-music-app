import type { JWT } from "next-auth/jwt";
import type { Account, Profile } from "next-auth";

// Trust provider-verified callback data only, never the client session-update body.
export function recordLoginIdentity(token: JWT, account: Pick<Account, "provider"> | null | undefined, profile?: Profile): JWT {
  if (!account) return token;
  token.loginProvider = account.provider;
  token.googleVerifiedEmail = account.provider === "google" && profile?.email_verified === true && typeof profile.email === "string"
    && profile.email === token.email ? profile.email : undefined;
  return token;
}
