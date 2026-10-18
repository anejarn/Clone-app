import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, SecretDecryptError, type SecretContext } from "@/lib/secrets/access-codes";
import { recordAudit } from "../../audit";
import type { Authorized } from "../../authz";
import { db } from "../../db";
import { AppError } from "../../errors";

/**
 * The organization's receiving address for booking e-mails (Lot 7b): a secret webhook URL,
 * <origin>/api/inbound-email/<token>, to give to the receiving service once it is chosen (it posts every message it
 * receives to it). 32 random bytes; stored as SHA-256 (organizations.inboundEmailTokenHash, the lookup key) and
 * encrypted (inboundEmailTokenEnc) so that the associés can copy it again. Regenerating replaces it (the old URL stops
 * at once); revoking removes it. ADMIN only (Synchronisation).
 */

export const INBOUND_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const ctx = (organizationId: string): SecretContext => ({ organizationId, purpose: "inbound-email-token" });

export function hashInboundToken(token: string): string {
  return createHash("sha256").update(`inbound:${token}`, "utf8").digest("hex");
}

export function inboundUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/inbound-email/${token}`;
}

export async function issueInboundAddress(actor: Authorized): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { inboundEmailTokenHash: true } });
    await tx.organization.update({
      where: { id: actor.organizationId },
      data: { inboundEmailTokenHash: hashInboundToken(token), inboundEmailTokenEnc: encryptSecret(token, ctx(actor.organizationId)), inboundEmailTokenIssuedAt: new Date() },
    });
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "channel.email_address_issued", targetType: "organization", targetId: actor.organizationId, details: { regenerated: !!before.inboundEmailTokenHash } });
  });
  return { token };
}

export async function revokeInboundAddress(actor: Authorized): Promise<void> {
  await db.$transaction(async (tx) => {
    const r = await tx.organization.updateMany({ where: { id: actor.organizationId, inboundEmailTokenHash: { not: null } }, data: { inboundEmailTokenHash: null, inboundEmailTokenEnc: null, inboundEmailTokenIssuedAt: null } });
    if (r.count === 0) throw new AppError(409, "NO_ADDRESS", "Aucune adresse de réception active.");
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "channel.email_address_revoked", targetType: "organization", targetId: actor.organizationId });
  });
}

/** The address to show (null when none issued). */
export async function inboundAddress(organizationId: string, origin: string): Promise<{ url: string | null; issuedAt: Date | null }> {
  const o = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { inboundEmailTokenEnc: true, inboundEmailTokenIssuedAt: true } });
  if (!o.inboundEmailTokenEnc) return { url: null, issuedAt: null };
  try {
    return { url: inboundUrl(origin, decryptSecret(o.inboundEmailTokenEnc, ctx(organizationId))), issuedAt: o.inboundEmailTokenIssuedAt };
  } catch (e) {
    if (!(e instanceof SecretDecryptError)) throw e;
    console.error(`inbound e-mail token of ${organizationId} unreadable: ${e.message}`);
    return { url: null, issuedAt: o.inboundEmailTokenIssuedAt };
  }
}

/** The organization a webhook token belongs to; null for an unknown, malformed or revoked one. */
export async function organizationOfInboundToken(token: string): Promise<string | null> {
  if (!INBOUND_TOKEN_RE.test(token)) return null;
  const o = await db.organization.findUnique({ where: { inboundEmailTokenHash: hashInboundToken(token) }, select: { id: true } });
  return o?.id ?? null;
}
