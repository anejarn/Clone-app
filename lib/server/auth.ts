import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { headers } from "next/headers";
import { SESSION_CACHE_MINUTES, SESSION_DAYS } from "@/lib/browser-storage";
import type { Role } from "@/lib/generated/prisma/client";
import { db } from "./db";
import { CONTROL_RE } from "./schemas";

/** Email + password accounts. Secret and public URL come from BETTER_AUTH_SECRET / BETTER_AUTH_URL. */
export const auth = betterAuth({
  appName: "Sigma",
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
  user: {
    // Read-only for clients (input: false): a sign-up always creates a GUEST with no organization, whatever the
    // body says, and update-user refuses them. Roles and memberships are set by an ADMIN (Lot 2), never by the user.
    additionalFields: {
      role: { type: "string", input: false, required: false, defaultValue: "GUEST" },
      organizationId: { type: "string", input: false, required: false, defaultValue: null },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * SESSION_DAYS,
    // Short-lived cookie copy of the session, so most requests skip the sessions table. Encrypted (JWE):
    // the default encoding is only signed, which leaves the name and email readable in the cookie.
    cookieCache: { enabled: true, maxAge: SESSION_CACHE_MINUTES * 60, strategy: "jwe" },
  },
  // On in production by default (e.g. 3 sign-ins per 10 s per IP). Only the e2e test server turns it off.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT === "off" ? false : undefined },
  hooks: {
    // The account name is free text: refuse control characters (Postgres can't store NUL), as the other routes do.
    before: createAuthMiddleware(async (ctx) => {
      const name: unknown = (ctx.body as { name?: unknown } | undefined)?.name;
      if (typeof name === "string" && CONTROL_RE.test(name)) {
        throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "name : caractères non autorisés" });
      }
    }),
  },
  plugins: [
    // Double authentification (TOTP + backup codes). Required for ADMIN and AGENT by lib/server/authz.ts; once on,
    // a password sign-in only answers { twoFactorRedirect } and the session is created after the code.
    // E-mail/SMS codes (otp) are not configured, so TOTP is the only method.
    twoFactor({ issuer: "Sigma", backupCodeOptions: { amount: 10, length: 10 } }),
    // Lets server actions set auth cookies. Must stay last.
    nextCookies(),
  ],
});

export type SessionUser = { id: string; name: string; email: string; role: Role; organizationId: string | null };

/** The signed-in user for this request, or null. Pass headers from a Route Handler; pages use next/headers. */
export async function getCurrentUser(requestHeaders?: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
  if (!session) return null;
  const { id, name, email, role, organizationId } = session.user;
  return { id, name, email, role: role as Role, organizationId: organizationId ?? null };
}
