/**
 * Encryption at rest of the booking e-mails (Lot 7b): the raw message (binary envelope) and what was extracted from it
 * (text envelope, JSON), both AES-256-GCM with the guide's key ACCESS_CODES_KEY (lib/secrets/access-codes.ts: same
 * keyring, rotation and fail-closed rules) and bound to the organization and the message (the hash of its
 * Message-ID): a value copied onto another row or organization doesn't decrypt. Generic part: lib/secrets/envelope.ts.
 */
import { openBytes, openText, sealBytes, sealText, type Keyring } from "./envelope";
import { keyring } from "./access-codes";

export interface InboundEmailContext {
  organizationId: string;
  messageIdHash: string;
}

const aad = (ctx: InboundEmailContext, what: "raw" | "details") => Buffer.from(`sigma:inbound-email:${what}:org=${ctx.organizationId}:mid=${ctx.messageIdHash}`, "utf8");

export function encryptRawEmail(raw: Uint8Array, ctx: InboundEmailContext, ring: Keyring = keyring()): Uint8Array<ArrayBuffer> {
  const sealed = sealBytes(raw, aad(ctx, "raw"), ring);
  return new Uint8Array(sealed);
}

export function decryptRawEmail(sealed: Uint8Array, ctx: InboundEmailContext, ring: Keyring = keyring()): Uint8Array {
  return openBytes(sealed, aad(ctx, "raw"), ring);
}

export function encryptEmailDetails(details: object, ctx: InboundEmailContext, ring: Keyring = keyring()): string {
  return sealText(JSON.stringify(details), aad(ctx, "details"), ring);
}

export function decryptEmailDetails<T>(envelope: string, ctx: InboundEmailContext, ring: Keyring = keyring()): T {
  return JSON.parse(openText(envelope, aad(ctx, "details"), ring, " (ACCESS_CODES_PREVIOUS_KEYS ?)")) as T;
}
