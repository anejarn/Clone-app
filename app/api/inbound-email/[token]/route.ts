import { MAX_EMAIL_BYTES, ingestInboundEmail } from "@/lib/server/channels/email/process";
import { organizationOfInboundToken } from "@/lib/server/channels/email/address";
import { AppError } from "@/lib/server/errors";
import { errorResponse, handle, readBodyBytes } from "@/lib/server/http";
import { inboundLimits } from "@/lib/server/channels/email/limits";
import { clientKey } from "@/lib/server/rate-limit";

/**
 * POST /api/inbound-email/<token>: the organization's receiving address for the platforms' booking e-mails (Lot 7b),
 * for whichever receiving service is chosen (none yet). No session: the 256-bit token (Synchronisation → E-mails) is
 * the key, looked up by its SHA-256; unknown or revoked → 404. Bodies:
 * - the raw message: Content-Type message/rfc822 (or text/plain, application/octet-stream);
 * - JSON { "raw": "<the message>", "encoding": "base64" | "utf8" (default utf8) };
 * - multipart/form-data with the message in a field or file named raw, email, mime or body-mime.
 * 5 MB per message (413), 120 messages per organization in 10 minutes (429), 20 bad tokens per client address in 10
 * minutes (429). Answers 202 { id, status, duplicate } once stored and applied (the same Message-ID again: the first
 * outcome, duplicate true). Never cached, never indexed.
 */

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const FIELDS = ["raw", "email", "mime", "body-mime"];

function tooLarge(): never {
  throw new AppError(413, "PAYLOAD_TOO_LARGE", "Message trop volumineux (5 Mo au maximum).");
}

async function messageOf(request: Request): Promise<Uint8Array> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "message/rfc822" || type === "text/plain" || type === "application/octet-stream" || type === "") {
    return readBodyBytes(request, MAX_EMAIL_BYTES);
  }
  if (type === "application/json") {
    const body = await readBodyBytes(request, Math.ceil(MAX_EMAIL_BYTES * 1.4) + 4096);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new AppError(400, "INVALID_JSON", "Corps JSON invalide.");
    }
    const { raw, encoding } = (json ?? {}) as { raw?: unknown; encoding?: unknown };
    if (typeof raw !== "string" || !raw) throw new AppError(400, "INVALID_INPUT", "raw : le message est obligatoire.");
    if (encoding !== undefined && encoding !== "base64" && encoding !== "utf8") throw new AppError(400, "INVALID_INPUT", "encoding : base64 ou utf8.");
    const bytes = encoding === "base64" ? new Uint8Array(Buffer.from(raw, "base64")) : new TextEncoder().encode(raw);
    if (bytes.byteLength > MAX_EMAIL_BYTES) tooLarge();
    return bytes;
  }
  if (type === "multipart/form-data") {
    const body = await readBodyBytes(request, MAX_EMAIL_BYTES + 256 * 1024);
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } }).formData().catch(() => {
      throw new AppError(400, "INVALID_INPUT", "Formulaire invalide.");
    });
    for (const name of FIELDS) {
      const v = form.get(name);
      if (typeof v === "string" && v) return new TextEncoder().encode(v);
      if (v instanceof Blob && v.size) return new Uint8Array(await v.arrayBuffer());
    }
    throw new AppError(400, "INVALID_INPUT", `Le message est attendu dans le champ ${FIELDS.join(", ")}.`);
  }
  throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Types acceptés : message/rfc822, application/json, multipart/form-data.");
}

export const POST = handle(async (request: Request, ctx: RouteContext<"/api/inbound-email/[token]">) => {
  const client = clientKey(request.headers);
  if (client && inboundLimits.badTokens.blocked(client)) return errorResponse(429, "TOO_MANY_REQUESTS", "Trop de tentatives.");
  const organizationId = await organizationOfInboundToken((await ctx.params).token);
  if (!organizationId) {
    if (client) inboundLimits.badTokens.fail(client);
    return errorResponse(404, "NOT_FOUND", "Adresse inconnue.");
  }
  if (!inboundLimits.perOrganization.take(organizationId)) return errorResponse(429, "TOO_MANY_REQUESTS", "Trop de messages : réessayez dans quelques minutes.");
  const raw = await messageOf(request);
  const r = await ingestInboundEmail({ organizationId, raw, via: "WEBHOOK" });
  return Response.json({ id: r.id, status: r.status, duplicate: r.duplicate }, { status: 202, headers });
});

