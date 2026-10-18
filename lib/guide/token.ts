import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Welcome guide links, /guide/<token>: 32 random bytes (256 bits) in base64url (43 characters), one per stay.
 * The database keeps the token's SHA-256 (guide_links.tokenHash, the lookup key: a leak gives no working link) and
 * the token encrypted (tokenEnc, lib/secrets/access-codes.ts) so the associés can copy the link again. Same shape as
 * the invitation tokens (lib/server/admin/invitation-token.ts); no server-only here, the seed and scripts use it.
 */

export const GUIDE_TOKEN_BYTES = 32;
export const GUIDE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateGuideToken(): string {
  return randomBytes(GUIDE_TOKEN_BYTES).toString("base64url");
}

export function hashGuideToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of a token with a stored hash. */
export function guideTokenMatches(token: string, tokenHash: string): boolean {
  const a = Buffer.from(hashGuideToken(token), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The guest's link, e.g. https://sigma.ma/guide/<token>?lang=es. */
export function guideUrl(origin: string, token: string, locale?: string | null): string {
  return `${origin.replace(/\/+$/, "")}/guide/${token}${locale ? `?lang=${locale}` : ""}`;
}
