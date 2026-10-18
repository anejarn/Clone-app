import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { resolveGuideLink } from "@/lib/server/guide/guest";
import { guideNotFoundHtml } from "@/lib/server/guide/not-found-html";
import { clientKey } from "@/lib/server/rate-limit";

/**
 * Runs before the page renders (Node.js runtime):
 * - /admin: first, optimistic gate of the back-office: a request without a session cookie is sent to the login page
 *   (HTTP 307). It only looks at the cookie's presence; the real checks (valid session, role, organization, double
 *   authentification) run in every page, action and API handler (lib/server/authz.ts), so a forged or stale cookie
 *   gets no further than here.
 * - /guide/<token>: the guest guide's link is checked here (lib/server/guide/guest.ts: unknown, revoked, cancelled
 *   stay, owner block, expired), so a link that opens nothing gets a real 404 — the page itself streams from a shell
 *   and could only answer 200. Failed lookups count against the client (rate limit). The page checks again.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/guide/")) {
    const token = path.split("/")[2];
    if (await resolveGuideLink(token, new Date(), clientKey(request.headers))) return NextResponse.next();
    return new NextResponse(guideNotFoundHtml(), {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

// The guide page only (its photos are checked by their route handler).
export const config = { matcher: ["/admin", "/admin/:path*", "/guide/:token"] };
