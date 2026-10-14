import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { SESSION_CACHE_MINUTES, SESSION_DAYS } from "@/lib/browser-storage";
import { db } from "./db";
import { CONTROL_RE } from "./schemas";

/** Email + password accounts. Secret and public URL come from BETTER_AUTH_SECRET / BETTER_AUTH_URL. */
export const auth = betterAuth({
  appName: "Sigma",
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
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
  // Lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type SessionUser = { id: string; name: string; email: string };

/** The signed-in user for this request, or null. Pass headers from a Route Handler; pages use next/headers. */
export async function getCurrentUser(requestHeaders?: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
  return session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null;
}
