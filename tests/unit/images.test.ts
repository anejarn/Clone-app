import { describe, expect, it } from "vitest";
import { checkPhoto, MAX_PHOTO_BYTES, sniffImageType } from "@/lib/storage/images";
import { assertStorageKey, STORAGE_KEY_RE } from "@/lib/storage/types";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe("listing photos", () => {
  it("are recognised by their first bytes", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    // GIF, SVG, PDF, a RIFF that isn't WebP (WAV), text.
    for (const other of [bytes(0x47, 0x49, 0x46, 0x38), new TextEncoder().encode("<svg xmlns="), bytes(0x25, 0x50, 0x44, 0x46), bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45), new TextEncoder().encode("hello")]) {
      expect(sniffImageType(other)).toBeNull();
    }
  });

  it("are refused when empty, too large or of another type", () => {
    expect(checkPhoto(JPEG)).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkPhoto(new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(PNG);
    expect(checkPhoto(big)).toMatchObject({ ok: false, message: expect.stringContaining("5 Mo") });
    const limit = new Uint8Array(MAX_PHOTO_BYTES);
    limit.set(PNG);
    expect(checkPhoto(limit)).toEqual({ ok: true, type: "image/png" });
    expect(checkPhoto(new TextEncoder().encode("GIF89a........"))).toMatchObject({ ok: false, message: expect.stringContaining("JPEG, PNG ou WebP") });
  });
});

describe("storage keys", () => {
  it("accept the keys the app makes and refuse paths that could leave the store", () => {
    expect(STORAGE_KEY_RE.test("listings/org_sigma/cmabc123/0123456789abcdef0123456789abcdef.jpg")).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a/./b", "a//b", "a\\b", "a/b/", ".hidden", "a/..", "a b", "a/%2e%2e/b", "a\u0000b"]) {
      expect(() => assertStorageKey(bad), JSON.stringify(bad)).toThrow();
    }
  });
});
