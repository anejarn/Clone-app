import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption at rest with named keys from the environment, key ids and rotation (node:crypto only).
 * Shared by the welcome guide's secrets (lib/secrets/access-codes.ts, ACCESS_CODES_KEY) and the travellers' identity
 * data (lib/secrets/identity.ts, IDENTITY_DOCS_KEY): each purpose has its own key, so a leak of one key opens nothing
 * of the other.
 *
 * Text envelope (what the database stores, checked by the migrations' *_check constraints):
 *   v1.<key id>.<iv>.<tag>.<ciphertext>      (base64url parts; key id = 8 hex characters)
 * Binary envelope (encrypted files, e.g. identity document scans):
 *   "SGE1" | key id (4 bytes) | iv (12) | tag (16) | ciphertext
 * - a fresh 12-byte IV per value, a 16-byte GCM tag: any change to the stored value is detected (decryption throws);
 * - "associated data" (aad) binds a value to where it belongs (organization, row, purpose): a ciphertext copied onto
 *   another row or another organization doesn't decrypt there;
 * - the key id is a fingerprint of the key (SHA-256 of a per-purpose label + the key, 4 bytes), never the key.
 *
 * Fails closed: in production (NODE_ENV=production) without a valid key nothing is encrypted or decrypted
 * (SecretsKeyError). In development and tests only, a fixed public development key is used instead (with a warning
 * from the caller), so `pnpm dev` and the seed work out of the box; it protects nothing.
 */

export const ENVELOPE_VERSION = "v1";
export const ENVELOPE_RE = /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ID_BYTES = 4;
export const BINARY_MAGIC = Buffer.from("SGE1", "ascii");
const BINARY_HEADER = BINARY_MAGIC.length + ID_BYTES + IV_BYTES + TAG_BYTES;

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
  /** True when the development key stands in for a missing key. */
  development: boolean;
}

/** What a keyring is made of: the environment variable names, the key id label and the development key. */
export interface KeySpec {
  /** e.g. "ACCESS_CODES_KEY". */
  name: string;
  /** e.g. "ACCESS_CODES_PREVIOUS_KEYS". */
  previousName: string;
  /** Prefix hashed with the key to make its id (changing it changes every key id). */
  idLabel: string;
  /** Seed of the public development key. */
  devSeed: string;
  /** What can't be done without the key, for the production error ("les codes d'accès"). */
  what: string;
}

export function keyIdFor(spec: Pick<KeySpec, "idLabel">, key: Buffer): string {
  return createHash("sha256").update(spec.idLabel).update(key).digest("hex").slice(0, 8);
}

function parseKey(value: string, name: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new SecretsKeyError(`${name} doit contenir 32 octets en base64 (openssl rand -base64 32).`);
  return key;
}

/** Reads a keyring from an environment. Throws SecretsKeyError when it can't be used. */
export function makeKeyring(spec: KeySpec, env: Record<string, string | undefined>): Keyring {
  const raw = env[spec.name]?.trim();
  let current: Buffer;
  let development = false;
  if (raw) current = parseKey(raw, spec.name);
  else if (env.NODE_ENV === "production") {
    throw new SecretsKeyError(`${spec.name} manquante : ${spec.what} ne peuvent être ni chiffrés ni lus en production.`);
  } else {
    current = createHash("sha256").update(spec.devSeed).digest();
    development = true;
  }
  const byId = new Map<string, Buffer>([[keyIdFor(spec, current), current]]);
  for (const [i, old] of (env[spec.previousName] ?? "").split(",").map((s) => s.trim()).filter(Boolean).entries()) {
    const k = parseKey(old, `${spec.previousName}[${i}]`);
    byId.set(keyIdFor(spec, k), k);
  }
  return { current: { id: keyIdFor(spec, current), key: current }, byId, development };
}

/** A process-wide keyring read once from process.env, replaceable by tests. */
export function keyringHolder(spec: KeySpec) {
  let cached: Keyring | undefined;
  let warned = false;
  return {
    get(): Keyring {
      if (!cached) {
        cached = makeKeyring(spec, process.env);
        if (cached.development && !warned) {
          warned = true;
          console.warn(`${spec.name} is not set: using the public development key (development only).`);
        }
      }
      return cached;
    },
    set(k: Keyring | undefined) {
      cached = k;
    },
  };
}

// ---------- Text ----------

export function sealText(plaintext: string, aad: Buffer, ring: Keyring): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new Error("sealText: empty value");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, ring.current.id, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

/** The key id an envelope was made with; null if it isn't an envelope. */
export function envelopeKeyId(envelope: string): string | null {
  return ENVELOPE_RE.test(envelope) ? envelope.split(".")[1] : null;
}

export function openText(envelope: string, aad: Buffer, ring: Keyring, unknownKeyHint = ""): string {
  if (typeof envelope !== "string" || !ENVELOPE_RE.test(envelope)) throw new SecretDecryptError("Format de secret inconnu.");
  const [, id, iv, tag, data] = envelope.split(".");
  const key = ring.byId.get(id);
  if (!key) throw new SecretDecryptError(`Clé de chiffrement inconnue${unknownKeyHint}.`);
  const ivBuf = Buffer.from(iv, "base64url");
  const tagBuf = Buffer.from(tag, "base64url");
  if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) throw new SecretDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, ivBuf, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tagBuf);
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError();
  }
}

// ---------- Bytes (files) ----------

export function sealBytes(bytes: Uint8Array, aad: Buffer, ring: Keyring): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("sealBytes: empty value");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([BINARY_MAGIC, Buffer.from(ring.current.id, "hex"), iv, tag, data]));
}

/** The key id of a binary envelope; null if it isn't one. */
export function bytesKeyId(sealed: Uint8Array): string | null {
  const b = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  if (b.length <= BINARY_HEADER || !b.subarray(0, BINARY_MAGIC.length).equals(BINARY_MAGIC)) return null;
  return b.subarray(BINARY_MAGIC.length, BINARY_MAGIC.length + ID_BYTES).toString("hex");
}

export function openBytes(sealed: Uint8Array, aad: Buffer, ring: Keyring): Uint8Array {
  const id = bytesKeyId(sealed);
  if (!id) throw new SecretDecryptError("Format de fichier chiffré inconnu.");
  const key = ring.byId.get(id);
  if (!key) throw new SecretDecryptError("Clé de chiffrement inconnue.");
  const b = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  let o = BINARY_MAGIC.length + ID_BYTES;
  const iv = b.subarray(o, (o += IV_BYTES));
  const tag = b.subarray(o, (o += TAG_BYTES));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(b.subarray(o)), decipher.final()]));
  } catch {
    throw new SecretDecryptError();
  }
}
