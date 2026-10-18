/**
 * Encryption at rest of the welcome guide's secrets: access codes, Wi-Fi passwords and the guide links' tokens
 * (Lot 4). AES-256-GCM with node:crypto (generic part: lib/secrets/envelope.ts); no library, no provider.
 *
 * Envelope (what the database stores, checked by the migration's *_secret_check / *_value_check constraints):
 *   v1.<key id>.<iv>.<tag>.<ciphertext>      (base64url parts; key id = 8 hex characters)
 * - a fresh 12-byte IV per value, the 16-byte GCM tag: any change to the stored value is detected (decrypt throws);
 * - "associated data" binds a value to where it belongs (organization, home or booking, purpose), so a ciphertext
 *   copied onto another row or another organization doesn't decrypt there;
 * - the key id is a fingerprint of the key (SHA-256 of a label + the key, 4 bytes), never the key.
 *
 * Keys come from the environment (32 random bytes in base64: `openssl rand -base64 32`):
 * - ACCESS_CODES_KEY: the current key, used to encrypt;
 * - ACCESS_CODES_PREVIOUS_KEYS (optional): older keys, comma-separated, still accepted to decrypt.
 * Rotation: put the new key in ACCESS_CODES_KEY and the old one in ACCESS_CODES_PREVIOUS_KEYS, restart, run
 * `pnpm secrets:rotate` (re-encrypts every value with the current key), then drop the old key.
 *
 * Fails closed: in production (NODE_ENV=production) without a valid ACCESS_CODES_KEY nothing is encrypted or
 * decrypted (SecretsKeyError). In development and tests only, a fixed development key is used instead, with a
 * warning, so `pnpm dev` and the seed work out of the box; never rely on it for real codes.
 */

import {
  envelopeKeyId,
  keyIdFor,
  keyringHolder,
  makeKeyring,
  openText,
  sealText,
  type KeySpec,
  type Keyring,
} from "./envelope";

export { ENVELOPE_RE, ENVELOPE_VERSION, envelopeKeyId, SecretDecryptError, SecretsKeyError, type Keyring, type SecretKey } from "./envelope";

/** The guide's key (lib/secrets/envelope.ts); the identity documents have their own (lib/secrets/identity.ts). */
export const ACCESS_CODES_KEY_SPEC: KeySpec = {
  name: "ACCESS_CODES_KEY",
  previousName: "ACCESS_CODES_PREVIOUS_KEYS",
  idLabel: "sigma-access-codes-key-id:",
  devSeed: "sigma-development-access-codes-key (not secret)",
  what: "les codes d'accès",
};

export function keyId(key: Buffer): string {
  return keyIdFor(ACCESS_CODES_KEY_SPEC, key);
}

/** Reads the keys from an environment (process.env by default). Throws SecretsKeyError when it can't be used. */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring {
  return makeKeyring(ACCESS_CODES_KEY_SPEC, env);
}

const holder = keyringHolder(ACCESS_CODES_KEY_SPEC);

/** The process's keyring, read once. */
export function keyring(): Keyring {
  return holder.get();
}

/** Tests (and a key change at run time) replace or reset the keyring. */
export function setKeyring(k: Keyring | undefined) {
  holder.set(k);
}

/**
 * Where a secret belongs: the associated data that binds it. Changing any part makes decryption fail.
 * - a home's access code / Wi-Fi password: { org, listing, purpose: "access-code" | "wifi" }
 * - a guide link's token: { org, booking, purpose: "guide-token" }
 * - a listing's iCal export token / the platform's import URL (Lot 7): { org, listing, purpose, scope: platform }
 * - the organization's booking e-mail webhook token (Lot 7b): { org, purpose: "inbound-email-token" }
 */
export interface SecretContext {
  organizationId: string;
  listingId?: string;
  bookingId?: string;
  purpose: "access-code" | "wifi" | "guide-token" | "ical-export-token" | "ical-import-url" | "inbound-email-token";
  /** Narrower binding, e.g. the platform of a listing's iCal feed (Lot 7). Left out of older values' context. */
  scope?: string;
}

function aad(ctx: SecretContext): Buffer {
  return Buffer.from(`sigma:${ctx.purpose}:org=${ctx.organizationId}:listing=${ctx.listingId ?? ""}:booking=${ctx.bookingId ?? ""}${ctx.scope ? `:scope=${ctx.scope}` : ""}`, "utf8");
}

export function encryptSecret(plaintext: string, ctx: SecretContext, ring: Keyring = keyring()): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new Error("encryptSecret: empty value");
  return sealText(plaintext, aad(ctx), ring);
}

/** Decrypts an envelope; throws SecretDecryptError on tampering, an unknown key or the wrong context. */
export function decryptSecret(envelope: string, ctx: SecretContext, ring: Keyring = keyring()): string {
  return openText(envelope, aad(ctx), ring, " (ACCESS_CODES_PREVIOUS_KEYS ?)");
}

/** Whether an envelope was made with an older key (to re-encrypt with `pnpm secrets:rotate`). */
export function needsRotation(envelope: string, ring: Keyring = keyring()): boolean {
  return envelopeKeyId(envelope) !== ring.current.id;
}

/** Re-encrypts with the current key; unchanged when it already uses it. */
export function rotateSecret(envelope: string, ctx: SecretContext, ring: Keyring = keyring()): string {
  if (!needsRotation(envelope, ring)) return envelope;
  return encryptSecret(decryptSecret(envelope, ctx, ring), ctx, ring);
}
