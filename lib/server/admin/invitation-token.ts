import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens: 32 random bytes (256 bits) in base64url, put in the link /invitation/<token> and shown once to
 * the admin. Only the SHA-256 is stored (invitations.tokenHash): a fast hash is enough for a random secret of this
 * size, and a database leak gives no working link.
 */

export const TOKEN_BYTES = 32;
/** 32 bytes in base64url without padding: 43 characters. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time check of a token against a stored hash. */
export function tokenMatches(token: string, tokenHash: string): boolean {
  const a = Buffer.from(hashInvitationToken(token), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
