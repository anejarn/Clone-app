import { describe, expect, it } from "vitest";
import { DEMO_TOTP_SECRET, DEMO_TOTP_SECRET_BASE32 } from "@/prisma/fixtures";
import { base32Decode, totpCode } from "../support/totp";

describe("test TOTP helper", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    const key = "12345678901234567890";
    // RFC 6238 appendix B, truncated to 6 digits.
    expect(totpCode(key, 59_000)).toBe("287082");
    expect(totpCode(key, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(key, 2_000_000_000_000)).toBe("279037");
  });

  it("decodes base32, and the documented demo key is the seeded secret", () => {
    expect(Buffer.from(base32Decode("MZXW6YTBOI")).toString()).toBe("foobar");
    expect(Buffer.from(base32Decode(DEMO_TOTP_SECRET_BASE32)).toString()).toBe(DEMO_TOTP_SECRET);
  });
});
