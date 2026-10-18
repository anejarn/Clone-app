import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Export links, /ical/<token>.ics (Lot 7): 32 random bytes (256 bits) in base64url, one per listing and platform.
 * Stored as SHA-256 (channel_feeds.exportTokenHash, the lookup key) and encrypted (exportTokenEnc) so that the associés
 * can copy the link again. Same shape as the guide links (lib/guide/token.ts).
 */

export const EXPORT_TOKEN_BYTES = 32;
export const EXPORT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateExportToken(): string {
  return randomBytes(EXPORT_TOKEN_BYTES).toString("base64url");
}

export function hashExportToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function exportTokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashExportToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** https://sigma.ma/ical/<token>.ics */
export function exportUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/ical/${token}.ics`;
}

/** The token of an /ical/<file> path segment, or null. */
export function tokenFromFile(file: string): string | null {
  const m = /^([A-Za-z0-9_-]{43})\.ics$/.exec(file);
  return m ? m[1] : null;
}
