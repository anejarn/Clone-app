import { tokenFromFile } from "@/lib/channels/token";
import { exportCalendarForToken } from "@/lib/server/channels/export";
import { FailureLimiter, clientKey } from "@/lib/server/rate-limit";

/**
 * GET/HEAD /ical/<token>.ics: a home's busy nights for one platform (Lot 7), read by the platform every few hours.
 * No session (the platform has none): the 256-bit token is the key. Unknown or revoked → 404. Never cached, never
 * indexed. 30 failed lookups per client address in 10 minutes block that address for the rest of the window.
 */

const limiter = new FailureLimiter(30, 10 * 60_000);

const baseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

function notFound() {
  return new Response("Calendrier introuvable.\n", { status: 404, headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}

async function serve(request: Request, ctx: RouteContext<"/ical/[file]">, head: boolean): Promise<Response> {
  const key = clientKey(request.headers);
  if (key && limiter.blocked(key)) return new Response("Trop de tentatives.\n", { status: 429, headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600" } });
  const token = tokenFromFile((await ctx.params).file);
  const cal = token ? await exportCalendarForToken(token) : null;
  if (!cal) {
    if (key) limiter.fail(key);
    return notFound();
  }
  const body = new TextEncoder().encode(cal.body);
  return new Response(head ? null : body, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Type": cal.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": 'inline; filename="sigma.ics"',
    },
  });
}

export async function GET(request: Request, ctx: RouteContext<"/ical/[file]">) {
  return serve(request, ctx, false);
}

export async function HEAD(request: Request, ctx: RouteContext<"/ical/[file]">) {
  return serve(request, ctx, true);
}
