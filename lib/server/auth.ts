import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { db } from "./db";

/** Email + password accounts. Secret and public URL come from BETTER_AUTH_SECRET / BETTER_AUTH_URL. */
export const auth = betterAuth({
  appName: "Nidou",
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    // Short-lived signed cookie copy of the session, so most requests skip the sessions table.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  // On in production by default (e.g. 3 sign-ins per 10 s per IP). Only the e2e test server turns it off.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT === "off" ? false : undefined },
  // Lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type SessionUser = { id: string; name: string; email: string };

/** The signed-in user for this request, or null. Pass headers from a Route Handler; pages use next/headers. */
export async function getCurrentUser(requestHeaders?: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
  return session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null;
}
