import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * First, optimistic gate of the back-office: a request to /admin without a session cookie is sent to the login
 * page before anything renders (HTTP 307). It only looks at the cookie's presence; the real checks (valid
 * session, role, organization, double authentification) run in every page, action and API handler
 * (lib/server/authz.ts), so a forged or stale cookie gets no further than here.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
