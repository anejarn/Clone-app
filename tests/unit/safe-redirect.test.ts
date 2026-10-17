import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

const O = "https://sigma.example";

describe("safeRedirectPath", () => {
  it("keeps same-site paths with their query and hash", () => {
    expect(safeRedirectPath("/trips", O)).toBe("/trips");
    expect(safeRedirectPath("/s/hivernage/homes?adults=2#top", O)).toBe("/s/hivernage/homes?adults=2#top");
    expect(safeRedirectPath("trips", O)).toBe("/trips");
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example/x",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "https://evil.example",
    "http://sigma.example.evil.example/",
    "javascript:alert(1)",
    "data:text/html,hi",
    " //evil.example",
  ])("refuses %j", (next) => {
    const out = safeRedirectPath(next, O);
    expect(new URL(out, O).origin).toBe(O);
    expect(out.startsWith("//")).toBe(false);
  });

  it("collapses paths that would become protocol-relative", () => {
    expect(safeRedirectPath("/.//evil.example", O)).toBe("/evil.example");
    expect(safeRedirectPath("https://sigma.example//evil.example", O)).toBe("/evil.example");
  });

  it("falls back to / on empty input", () => {
    expect(safeRedirectPath(null, O)).toBe("/");
    expect(safeRedirectPath("", O)).toBe("/");
  });
});
