import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("keeps colours next to custom font sizes", () => {
    expect(cn("bg-ink text-white h-12 text-body-l")).toBe("bg-ink text-white h-12 text-body-l");
    expect(cn("text-ink text-caption")).toBe("text-ink text-caption");
  });
  it("still lets later sizes and colours win", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-ink", "text-white")).toBe("text-white");
  });
});
