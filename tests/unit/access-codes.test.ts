import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  ENVELOPE_RE,
  envelopeKeyId,
  keyId,
  keyringFromEnv,
  needsRotation,
  rotateSecret,
  SecretDecryptError,
  SecretsKeyError,
  type SecretContext,
} from "@/lib/secrets/access-codes";

/** Encryption at rest of access codes, Wi-Fi passwords and guide tokens (lib/secrets/access-codes.ts). */

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const ringA = keyringFromEnv({ ACCESS_CODES_KEY: KEY_A, NODE_ENV: "production" });
const ctx: SecretContext = { organizationId: "org_sigma", listingId: "1001", purpose: "access-code" };

/** Changes one character of a base64url part of an envelope. */
function tamper(envelope: string, part: number): string {
  const parts = envelope.split(".");
  const s = parts[part];
  const i = Math.floor(s.length / 2);
  parts[part] = s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  return parts.join(".");
}

describe("AES-256-GCM envelopes", () => {
  it("round-trips, with a fresh IV each time, in the format the database checks", () => {
    const a = encryptSecret("4815 #", ctx, ringA);
    const b = encryptSecret("4815 #", ctx, ringA);
    expect(a).not.toBe(b);
    expect(a).toMatch(ENVELOPE_RE);
    expect(a).not.toContain("4815");
    expect(decryptSecret(a, ctx, ringA)).toBe("4815 #");
    expect(decryptSecret(encryptSecret("Mot de passe é ✓ 🔑", ctx, ringA), ctx, ringA)).toBe("Mot de passe é ✓ 🔑");
    expect(envelopeKeyId(a)).toBe(ringA.current.id);
  });

  it("detects any change to the IV, the tag or the data", () => {
    const e = encryptSecret("123456", ctx, ringA);
    for (const part of [2, 3, 4]) expect(() => decryptSecret(tamper(e, part), ctx, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptSecret(e.replace(/^v1/, "v2"), ctx, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptSecret("1234", ctx, ringA)).toThrow(SecretDecryptError);
  });

  it("is bound to its context: another listing, organization or purpose can't read it", () => {
    const e = encryptSecret("123456", ctx, ringA);
    expect(() => decryptSecret(e, { ...ctx, listingId: "1002" }, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptSecret(e, { ...ctx, organizationId: "org_other" }, ringA)).toThrow(SecretDecryptError);
    expect(() => decryptSecret(e, { ...ctx, purpose: "wifi" }, ringA)).toThrow(SecretDecryptError);
  });

  it("refuses an empty value", () => {
    expect(() => encryptSecret("", ctx, ringA)).toThrow();
  });
});

describe("keys", () => {
  it("fails closed in production without a key, or with a key that isn't 32 bytes", () => {
    expect(() => keyringFromEnv({ NODE_ENV: "production" })).toThrow(SecretsKeyError);
    expect(() => keyringFromEnv({ NODE_ENV: "production", ACCESS_CODES_KEY: "  " })).toThrow(SecretsKeyError);
    expect(() => keyringFromEnv({ ACCESS_CODES_KEY: Buffer.alloc(16).toString("base64") })).toThrow(SecretsKeyError);
    expect(() => keyringFromEnv({ ACCESS_CODES_KEY: KEY_A, ACCESS_CODES_PREVIOUS_KEYS: "abc" })).toThrow(SecretsKeyError);
  });

  it("uses the public development key outside production only", () => {
    const dev = keyringFromEnv({ NODE_ENV: "development" });
    expect(dev.development).toBe(true);
    expect(ringA.development).toBe(false);
    expect(decryptSecret(encryptSecret("x", ctx, dev), ctx, dev)).toBe("x");
    expect(() => decryptSecret(encryptSecret("x", ctx, dev), ctx, ringA)).toThrow(SecretDecryptError);
  });

  it("names a key by a fingerprint that doesn't reveal it", () => {
    expect(ringA.current.id).toMatch(/^[0-9a-f]{8}$/);
    expect(ringA.current.id).toBe(keyId(Buffer.from(KEY_A, "base64")));
    expect(keyId(Buffer.from(KEY_B, "base64"))).not.toBe(ringA.current.id);
  });

  it("rotates: the new key reads old values through ACCESS_CODES_PREVIOUS_KEYS and re-encrypts them", () => {
    const old = encryptSecret("2580", ctx, ringA);
    const ringB = keyringFromEnv({ ACCESS_CODES_KEY: KEY_B, ACCESS_CODES_PREVIOUS_KEYS: ` ${KEY_A} ` });
    const onlyB = keyringFromEnv({ ACCESS_CODES_KEY: KEY_B });
    expect(() => decryptSecret(old, ctx, onlyB)).toThrow(/inconnue/);
    expect(decryptSecret(old, ctx, ringB)).toBe("2580");
    expect(needsRotation(old, ringB)).toBe(true);
    const rotated = rotateSecret(old, ctx, ringB);
    expect(envelopeKeyId(rotated)).toBe(ringB.current.id);
    expect(needsRotation(rotated, ringB)).toBe(false);
    expect(rotateSecret(rotated, ctx, ringB)).toBe(rotated);
    // Once rotated, the old key can go.
    expect(decryptSecret(rotated, ctx, onlyB)).toBe("2580");
  });
});
