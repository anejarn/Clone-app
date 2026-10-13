import { createHostLead, HOST_LEAD_MAX_BYTES, hostLeadInputSchema } from "@/lib/server/host-leads";
import { assertSameOrigin, handle, readJson } from "@/lib/server/http";

/**
 * POST /api/host-leads { name, email, phone?, placeSlug, propertyType, beds, openWinterWeeks,
 * registrationNumber?, message?, consent: true } → 201 { ok: true }. Public; nothing stored is echoed back,
 * and there is no read endpoint. Bodies over 16 KB get 413 PAYLOAD_TOO_LARGE before they are parsed.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  await createHostLead(await readJson(request, hostLeadInputSchema, { maxBytes: HOST_LEAD_MAX_BYTES }));
  return Response.json({ ok: true }, { status: 201 });
});
