import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest of the welcome guide's secrets: access codes, Wi-Fi passwords and the guide links' tokens
 * (Lot 4). AES-256-GCM with node:crypto; no library, no provider.
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

export const ENVELOPE_VERSION = "v1";
export const ENVELOPE_RE = /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Only outside production, when ACCESS_CODES_KEY is unset. Public: protects nothing. */
const DEV_KEY = createHash("sha256").update("sigma-development-access-codes-key (not secret)").digest();

export class SecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsKeyError";
  }
}

export class SecretDecryptError extends Error {
  constructor(message = "Secret illisible : valeur modifiée, clé inconnue ou mauvais contexte.") {
    super(message);
    this.name = "SecretDecryptError";
  }
}

export interface SecretKey {
  id: string;
  key: Buffer;
}

export interface Keyring {
  current: SecretKey;
  /** Every key that may decrypt, by id (the current one included). */
  byId: Map<string, Buffer>;
  /** True when the development key stands in for a missing ACCESS_CODES_KEY. */
  development: boolean;
}

export function keyId(key: Buffer): string {
  return createHash("sha256").update("sigma-access-codes-key-id:").update(key).digest("hex").slice(0, 8);
}

function parseKey(value: string, name: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new SecretsKeyError(`${name} doit contenir 32 octets en base64 (openssl rand -base64 32).`);
  return key;
}

/** Reads the keys from an environment (process.env by default). Throws SecretsKeyError when it can't be used. */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring {
  const raw = env.ACCESS_CODES_KEY?.trim();
  let current: Buffer;
  let development = false;
  if (raw) current = parseKey(raw, "ACCESS_CODES_KEY");
  else if (env.NODE_ENV === "production") {
    throw new SecretsKeyError("ACCESS_CODES_KEY manquante : les codes d'accès ne peuvent être ni chiffrés ni lus en production.");
  } else {
    current = DEV_KEY;
    development = true;
  }
  const byId = new Map<string, Buffer>([[keyId(current), current]]);
  for (const [i, old] of (env.ACCESS_CODES_PREVIOUS_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean).entries()) {
    const k = parseKey(old, `ACCESS_CODES_PREVIOUS_KEYS[${i}]`);
    byId.set(keyId(k), k);
  }
  return { current: { id: keyId(current), key: current }, byId, development };
}

let cached: Keyring | undefined;
let warned = false;

/** The process's keyring, read once. */
export function keyring(): Keyring {
  if (!cached) {
    cached = keyringFromEnv();
    if (cached.development && !warned) {
      warned = true;
      console.warn("ACCESS_CODES_KEY is not set: using the public development key for access codes (development only).");
    }
  }
  return cached;
}

/** Tests (and a key change at run time) replace or reset the keyring. */
export function setKeyring(k: Keyring | undefined) {
  cached = k;
}

/**
 * Where a secret belongs: the associated data that binds it. Changing any part makes decryption fail.
 * - a home's access code / Wi-Fi password: { org, listing, purpose: "access-code" | "wifi" }
 * - a guide link's token: { org, booking, purpose: "guide-token" }
 */
export interface SecretContext {
  organizationId: string;
  listingId?: string;
  bookingId?: string;
  purpose: "access-code" | "wifi" | "guide-token";
}

function aad(ctx: SecretContext): Buffer {
  return Buffer.from(`sigma:${ctx.purpose}:org=${ctx.organizationId}:listing=${ctx.listingId ?? ""}:booking=${ctx.bookingId ?? ""}`, "utf8");
}

export function encryptSecret(plaintext: string, ctx: SecretContext, ring: Keyring = keyring()): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new Error("encryptSecret: empty value");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(ctx));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, ring.current.id, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

/** The key id an envelope was made with; null if it isn't an envelope. */
export function envelopeKeyId(envelope: string): string | null {
  return ENVELOPE_RE.test(envelope) ? envelope.split(".")[1] : null;
}

/** Decrypts an envelope; throws SecretDecryptError on tampering, an unknown key or the wrong context. */
export function decryptSecret(envelope: string, ctx: SecretContext, ring: Keyring = keyring()): string {
  if (typeof envelope !== "string" || !ENVELOPE_RE.test(envelope)) throw new SecretDecryptError("Format de secret inconnu.");
  const [, id, iv, tag, data] = envelope.split(".");
  const key = ring.byId.get(id);
  if (!key) throw new SecretDecryptError("Clé de chiffrement inconnue (ACCESS_CODES_PREVIOUS_KEYS ?).");
  const ivBuf = Buffer.from(iv, "base64url");
  const tagBuf = Buffer.from(tag, "base64url");
  if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) throw new SecretDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, ivBuf, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(ctx));
    decipher.setAuthTag(tagBuf);
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError();
  }
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
