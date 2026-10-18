import {
  bytesKeyId,
  envelopeKeyId,
  keyIdFor,
  keyringHolder,
  makeKeyring,
  openBytes,
  openText,
  sealBytes,
  sealText,
  type KeySpec,
  type Keyring,
} from "./envelope";

/**
 * Encryption at rest of the travellers' identity data (Lot 5: fiche de police): every personal field of a traveller
 * (one envelope per traveller, `travelers.identityEnc`) and the scans/photos of their identity documents (encrypted
 * before they reach lib/storage). AES-256-GCM (lib/secrets/envelope.ts) under a key of its own, separate from the
 * guide's ACCESS_CODES_KEY:
 * - IDENTITY_DOCS_KEY: the current key (32 random bytes in base64, `openssl rand -base64 32`), used to encrypt;
 * - IDENTITY_DOCS_PREVIOUS_KEYS (optional): older keys, comma-separated, still accepted to decrypt.
 * Rotation: new key in IDENTITY_DOCS_KEY, the old one in IDENTITY_DOCS_PREVIOUS_KEYS, restart, `pnpm secrets:rotate`
 * (re-encrypts the fields and the files), then drop the old key.
 *
 * Fails closed in production (SecretsKeyError without a valid key: nothing is recorded or shown). Development and
 * tests fall back to a public development key, never to be used for real identities.
 *
 * Associated data: a traveller's fields are bound to { organization, booking, traveller }, a file to { organization,
 * traveller, storage key }: copied onto another row, file or organization, they don't decrypt.
 */

export const IDENTITY_KEY_SPEC: KeySpec = {
  name: "IDENTITY_DOCS_KEY",
  previousName: "IDENTITY_DOCS_PREVIOUS_KEYS",
  idLabel: "sigma-identity-docs-key-id:",
  devSeed: "sigma-development-identity-docs-key (not secret)",
  what: "les pièces d'identité",
};

export function identityKeyId(key: Buffer): string {
  return keyIdFor(IDENTITY_KEY_SPEC, key);
}

export function identityKeyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring {
  return makeKeyring(IDENTITY_KEY_SPEC, env);
}

const holder = keyringHolder(IDENTITY_KEY_SPEC);

export function identityKeyring(): Keyring {
  return holder.get();
}

export function setIdentityKeyring(k: Keyring | undefined) {
  holder.set(k);
}

export interface TravelerContext {
  organizationId: string;
  bookingId: string;
  travelerId: string;
}

export interface DocumentContext {
  organizationId: string;
  travelerId: string;
  storageKey: string;
}

const fieldsAad = (c: TravelerContext) => Buffer.from(`sigma:identity:org=${c.organizationId}:booking=${c.bookingId}:traveler=${c.travelerId}`, "utf8");
const fileAad = (c: DocumentContext) => Buffer.from(`sigma:identity-document:org=${c.organizationId}:traveler=${c.travelerId}:key=${c.storageKey}`, "utf8");

/** Encrypts a traveller's fields (a JSON object) into one envelope. */
export function encryptIdentity(fields: object, ctx: TravelerContext, ring: Keyring = identityKeyring()): string {
  return sealText(JSON.stringify(fields), fieldsAad(ctx), ring);
}

/** Decrypts a traveller's fields; throws SecretDecryptError on tampering, an unknown key or the wrong context. */
export function decryptIdentity<T = Record<string, unknown>>(envelope: string, ctx: TravelerContext, ring: Keyring = identityKeyring()): T {
  return JSON.parse(openText(envelope, fieldsAad(ctx), ring, " (IDENTITY_DOCS_PREVIOUS_KEYS ?)")) as T;
}

export function encryptDocument(bytes: Uint8Array, ctx: DocumentContext, ring: Keyring = identityKeyring()): Uint8Array {
  return sealBytes(bytes, fileAad(ctx), ring);
}

export function decryptDocument(sealed: Uint8Array, ctx: DocumentContext, ring: Keyring = identityKeyring()): Uint8Array {
  return openBytes(sealed, fileAad(ctx), ring);
}

export function identityNeedsRotation(envelope: string, ring: Keyring = identityKeyring()): boolean {
  return envelopeKeyId(envelope) !== ring.current.id;
}

export function documentNeedsRotation(sealed: Uint8Array, ring: Keyring = identityKeyring()): boolean {
  return bytesKeyId(sealed) !== ring.current.id;
}
