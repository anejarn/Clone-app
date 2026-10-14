import { createHostLead, HOST_LEAD_MAX_BYTES, HOST_LEAD_RATE_LIMIT, hostLeadInputSchema } from "@/lib/server/host-leads";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, handle, readJson } from "@/lib/server/http";
import { clientIp, createRateLimiter, rateLimitsEnabled } from "@/lib/server/rate-limit";

/** In this server instance's memory: each instance counts on its own. */
const limiter = createRateLimiter(HOST_LEAD_RATE_LIMIT);

/**
 * POST /api/host-leads { name, email, phone?, placeSlug, propertyType, beds, openWinterWeeks,
 * registrationNumber?, message?, consent: true, website? } → 201 { ok: true }. Public; nothing stored is echoed
 * back, and there is no read endpoint. Bodies over 16 KB get 413 PAYLOAD_TOO_LARGE before they are parsed.
 * Spam: 10 requests per 10 minutes per client IP (429 RATE_LIMITED, off with AUTH_RATE_LIMIT=off); `website` is
 * a honeypot; a repeat of the same email and resort within 24 hours is not stored again. All three answer as usual.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  if (rateLimitsEnabled() && !limiter.take(clientIp(request.headers) ?? "unknown")) {
    throw new AppError(429, "RATE_LIMITED", "Trop de demandes envoyées. Réessayez dans quelques minutes.");
  }
  await createHostLead(await readJson(request, hostLeadInputSchema, { maxBytes: HOST_LEAD_MAX_BYTES }));
  return Response.json({ ok: true }, { status: 201 });
});
