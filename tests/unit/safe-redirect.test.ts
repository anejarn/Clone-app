import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

const O = "https://nidou.fr";

describe("safeRedirectPath", () => {
  it("keeps same-site paths with their query and hash", () => {
    expect(safeRedirectPath("/trips", O)).toBe("/trips");
    expect(safeRedirectPath("/s/paris/homes?adults=2#top", O)).toBe("/s/paris/homes?adults=2#top");
    expect(safeRedirectPath("trips", O)).toBe("/trips");
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example/x",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "https://evil.example",
    "http://nidou.fr.evil.example/",
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
    expect(safeRedirectPath("https://nidou.fr//evil.example", O)).toBe("/evil.example");
  });

  it("falls back to / on empty input", () => {
    expect(safeRedirectPath(null, O)).toBe("/");
    expect(safeRedirectPath("", O)).toBe("/");
  });
});
