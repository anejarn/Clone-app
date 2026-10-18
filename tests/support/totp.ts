import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the codes an authenticator app shows: lets the tests sign in staff with
 * double authentification. `secret` is the raw key (Better Auth's stored secret) or, with `base32`, the key as
 * shown on the enrollment page.
 */
export function totpCode(secret: string | Uint8Array, now = Date.now(), period = 30): string {
  const key = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const h = createHmac("sha1", key).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  const bin = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  let bits = "";
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error(`not base32: ${c}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

/** Shared by the integration and e2e suites, and passed to the seed so its encrypted demo secrets match. */
export const TEST_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-0123456789abcdef0123456789";
