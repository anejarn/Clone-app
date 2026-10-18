import { describe, expect, it } from "vitest";
import { encryptSecret, keyringFromEnv } from "@/lib/secrets/access-codes";
import { BINARY_MAGIC, ENVELOPE_RE, SecretDecryptError, SecretsKeyError } from "@/lib/secrets/envelope";
import {
  decryptDocument,
  decryptIdentity,
  documentNeedsRotation,
  encryptDocument,
  encryptIdentity,
  identityKeyId,
  identityKeyringFromEnv,
  identityNeedsRotation,
  type DocumentContext,
  type TravelerContext,
} from "@/lib/secrets/identity";

/** Encryption at rest of the travellers' identity fields and document scans (lib/secrets/identity.ts, Lot 5). */

const KEY_A = Buffer.alloc(32, 3).toString("base64");
const KEY_B = Buffer.alloc(32, 4).toString("base64");
const ringA = identityKeyringFromEnv({ IDENTITY_DOCS_KEY: KEY_A, NODE_ENV: "production" });
const ctx: TravelerContext = { organizationId: "org_sigma", bookingId: "b1", travelerId: "t1" };
const docCtx: DocumentContext = { organizationId: "org_sigma", travelerId: "t1", storageKey: "identity/org_sigma/b1/00ff.enc" };
const FIELDS = { lastName: "TESTNOM", firstName: "Prénom ✓", documentNumber: "TEST000001", birthDate: "1990-01-01", nationality: "FR" };

function tamper(envelope: string, part: number): string {
  const parts = envelope.split(".");
  const s = parts[part];
  const i = Math.floor(s.length / 2);
  parts[part] = s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  return parts.join(".");
}

describe("identity fields", () => {
  it("round-trip as one envelope, in the format the database checks, without any value in clear", () => {
    const e = encryptIdentity(FIELDS, ctx, ringA);
    expect(e).toMatch(ENVELOPE_RE);
    // Values of 6+ characters only: a short one like "FR" can turn up by chance in random base64url ciphertext.
    for (const v of Object.values(FIELDS).filter((v) => v.length >= 6)) expect(e).not.toContain(v);
    expect(decryptIdentity(e, ctx, ringA)).toEqual(FIELDS);
    expect(encryptIdentity(FIELDS, ctx, ringA)).not.toBe(e);
  });

  it("detect tampering", () => {
    const e = encryptIdentity(FIELDS, ctx, ringA);
    for (const part of [2, 3, 4]) expect(() => decryptIdentity(tamper(e, part), ctx, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptIdentity("TESTNOM", ctx, ringA)).toThrow(SecretDecryptError);
  });

  it("are bound to their organization, booking and traveller", () => {
    const e = encryptIdentity(FIELDS, ctx, ringA);
    expect(() => decryptIdentity(e, { ...ctx, organizationId: "org_other" }, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptIdentity(e, { ...ctx, bookingId: "b2" }, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptIdentity(e, { ...ctx, travelerId: "t2" }, ringA)).toThrow(SecretDecryptError);
  });

  it("use a key of their own: the guide's key can't read them, nor theirs the guide's", () => {
    // Same bytes in both variables: still separate key ids and separate associated data.
    const guideRing = keyringFromEnv({ ACCESS_CODES_KEY: KEY_A, NODE_ENV: "production" });
    expect(guideRing.current.id).not.toBe(ringA.current.id);
    const e = encryptIdentity(FIELDS, ctx, ringA);
    expect(() => decryptIdentity(e, ctx, guideRing)).toThrow(SecretDecryptError);
    const code = encryptSecret("1234", { organizationId: "org_sigma", listingId: "1001", purpose: "access-code" }, guideRing);
    expect(() => decryptIdentity(code, ctx, ringA)).toThrow(SecretDecryptError);
    expect(identityKeyId(Buffer.from(KEY_A, "base64"))).toBe(ringA.current.id);
  });

  it("rotate: old envelopes still read with the previous key, flagged for re-encryption", () => {
    const old = encryptIdentity(FIELDS, ctx, ringA);
    const ringB = identityKeyringFromEnv({ IDENTITY_DOCS_KEY: KEY_B, IDENTITY_DOCS_PREVIOUS_KEYS: KEY_A, NODE_ENV: "production" });
    expect(decryptIdentity(old, ctx, ringB)).toEqual(FIELDS);
    expect(identityNeedsRotation(old, ringB)).toBe(true);
    const fresh = encryptIdentity(decryptIdentity(old, ctx, ringB), ctx, ringB);
    expect(identityNeedsRotation(fresh, ringB)).toBe(false);
    // Once the old key is dropped, the old envelope is unreadable.
    const onlyB = identityKeyringFromEnv({ IDENTITY_DOCS_KEY: KEY_B, NODE_ENV: "production" });
    expect(() => decryptIdentity(old, ctx, onlyB)).toThrow(/IDENTITY_DOCS_PREVIOUS_KEYS/);
    expect(decryptIdentity(fresh, ctx, onlyB)).toEqual(FIELDS);
  });
});

describe("keys", () => {
  it("fail closed in production without a valid key", () => {
    expect(() => identityKeyringFromEnv({ NODE_ENV: "production" })).toThrow(SecretsKeyError);
    expect(() => identityKeyringFromEnv({ NODE_ENV: "production", IDENTITY_DOCS_KEY: " " })).toThrow(/IDENTITY_DOCS_KEY/);
    expect(() => identityKeyringFromEnv({ IDENTITY_DOCS_KEY: Buffer.alloc(16).toString("base64") })).toThrow(SecretsKeyError);
    expect(() => identityKeyringFromEnv({ IDENTITY_DOCS_KEY: KEY_A, IDENTITY_DOCS_PREVIOUS_KEYS: "abc" })).toThrow(SecretsKeyError);
    // The guide's key doesn't stand in for it.
    expect(() => identityKeyringFromEnv({ NODE_ENV: "production", ACCESS_CODES_KEY: KEY_A })).toThrow(SecretsKeyError);
  });

  it("fall back to a public development key outside production only, different from the guide's", () => {
    const dev = identityKeyringFromEnv({ NODE_ENV: "development" });
    expect(dev.development).toBe(true);
    expect(dev.current.key.equals(keyringFromEnv({ NODE_ENV: "development" }).current.key)).toBe(false);
    expect(identityKeyringFromEnv({ NODE_ENV: "test", IDENTITY_DOCS_KEY: KEY_A }).development).toBe(false);
  });
});

describe("document scans", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("TEST000001 scan bytes")]);

  it("round-trip, the stored bytes holding neither the image nor its text", () => {
    const sealed = encryptDocument(JPEG, docCtx, ringA);
    expect(Buffer.from(sealed.subarray(0, 4)).equals(BINARY_MAGIC)).toBe(true);
    expect(Buffer.from(sealed).includes(Buffer.from("TEST000001"))).toBe(false);
    expect(Buffer.from(sealed).includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(Buffer.from(decryptDocument(sealed, docCtx, ringA)).equals(Buffer.from(JPEG))).toBe(true);
  });

  it("detect tampering, truncation and the wrong context", () => {
    const sealed = encryptDocument(JPEG, docCtx, ringA);
    const flipped = new Uint8Array(sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => decryptDocument(flipped, docCtx, ringA)).toThrow(SecretDecryptError);
    const tag = new Uint8Array(sealed);
    tag[4 + 4 + 12] ^= 1;
    expect(() => decryptDocument(tag, docCtx, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptDocument(sealed.subarray(0, 20), docCtx, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptDocument(JPEG, docCtx, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptDocument(sealed, { ...docCtx, storageKey: "identity/org_sigma/b1/other.enc" }, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptDocument(sealed, { ...docCtx, travelerId: "t2" }, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptDocument(sealed, { ...docCtx, organizationId: "org_other" }, ringA)).toThrow(SecretDecryptError);
  });

  it("rotate with the previous keys", () => {
    const sealed = encryptDocument(JPEG, docCtx, ringA);
    const ringB = identityKeyringFromEnv({ IDENTITY_DOCS_KEY: KEY_B, IDENTITY_DOCS_PREVIOUS_KEYS: KEY_A, NODE_ENV: "production" });
    expect(documentNeedsRotation(sealed, ringB)).toBe(true);
    expect(documentNeedsRotation(sealed, ringA)).toBe(false);
    expect(Buffer.from(decryptDocument(sealed, docCtx, ringB)).equals(Buffer.from(JPEG))).toBe(true);
    expect(() => decryptDocument(sealed, docCtx, identityKeyringFromEnv({ IDENTITY_DOCS_KEY: KEY_B, NODE_ENV: "production" }))).toThrow(SecretDecryptError);
  });

  it("refuse an empty file", () => {
    expect(() => encryptDocument(new Uint8Array(0), docCtx, ringA)).toThrow();
  });
});
