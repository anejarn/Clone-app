import { describe, expect, it } from "vitest";
import { contentKey, matchListing, messageKey, normalizeName, type ListingCandidate } from "@/lib/channels/email/match";

/** Which home a booking e-mail is about, and the idempotency keys (lib/channels/email/match.ts). */

const homes: ListingCandidate[] = [
  { listingId: "a", title: "Riad Jasmin · Médina", feeds: [{ source: "AIRBNB", platformListingId: "40000001", platformListingName: "Riad Test Jasmin" }] },
  { listingId: "b", title: "Dar Menthe", feeds: [{ source: "BOOKING", platformListingId: "9900001", platformListingName: null }, { source: "AIRBNB", platformListingId: null, platformListingName: "Dar Menthe – terrasse" }] },
  { listingId: "c", title: "Villa Palmeraie", feeds: [] },
  { listingId: "d", title: "Villa Palmeraie Bis", feeds: [] },
];

describe("matchListing", () => {
  it("by the platform's id on that platform's feed only", () => {
    expect(matchListing(homes, "AIRBNB", { platformId: "40000001", name: null })).toEqual({ kind: "match", listingId: "a", by: "PLATFORM_ID" });
    expect(matchListing(homes, "BOOKING", { platformId: " 9900001 ", name: null })).toEqual({ kind: "match", listingId: "b", by: "PLATFORM_ID" });
    // Booking.com's id written on an Airbnb feed means nothing.
    expect(matchListing(homes, "AGODA", { platformId: "9900001", name: null })).toEqual({ kind: "none" });
  });

  it("by the platform's title, then the Sigma title, without case, accents or punctuation", () => {
    expect(matchListing(homes, "AIRBNB", { platformId: "999", name: "riad test JASMIN" })).toEqual({ kind: "match", listingId: "a", by: "PLATFORM_NAME" });
    expect(matchListing(homes, "BOOKING", { platformId: null, name: "Riad Jasmin - Medina" })).toEqual({ kind: "match", listingId: "a", by: "TITLE" });
  });

  it("partial names: one home → it; several → ambiguous; nothing → none", () => {
    expect(matchListing(homes, "AIRBNB", { platformId: null, name: "Dar Menthe – terrasse (vue Atlas)" })).toEqual({ kind: "match", listingId: "b", by: "PARTIAL_NAME" });
    expect(matchListing(homes, "AGODA", { platformId: null, name: "Villa Palmeraie" })).toEqual({ kind: "match", listingId: "c", by: "TITLE" });
    expect(matchListing(homes, "AGODA", { platformId: null, name: "Palmeraie" })).toEqual({ kind: "ambiguous", listingIds: ["c", "d"] });
    expect(matchListing(homes, "AGODA", { platformId: null, name: "Riad inconnu" })).toEqual({ kind: "none" });
    expect(matchListing(homes, "AGODA", { platformId: null, name: null })).toEqual({ kind: "none" });
    // Short names don't match partially.
    expect(matchListing(homes, "AGODA", { platformId: null, name: "Dar" })).toEqual({ kind: "none" });
  });

  it("an organization with a single home takes it", () => {
    expect(matchListing([homes[2]], "TRIPCOM", { platformId: null, name: null })).toEqual({ kind: "match", listingId: "c", by: "ONLY_HOME" });
    expect(matchListing([], "TRIPCOM", { platformId: null, name: "x" })).toEqual({ kind: "none" });
  });

  it("normalizeName", () => {
    expect(normalizeName("  Riad Test – Jasmin (Médina)! ")).toBe("riad test jasmin medina");
  });
});

describe("idempotency keys", () => {
  it("the Message-ID, trimmed, without brackets, any case; the raw hash when none", () => {
    const a = messageKey("<ABC@booking.example>", "r1");
    expect(messageKey(" abc@booking.example ", "r2")).toBe(a);
    expect(messageKey(null, "r1")).not.toBe(messageKey(null, "r2"));
    expect(messageKey("", "r1")).toBe(messageKey(null, "r1"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the content: same platform, kind, code, nights, guests and amount; none without a code", () => {
    const p = { platform: "BOOKING" as const, kind: "CONFIRMATION" as const, code: "4012345678", checkIn: "2027-10-10", checkOut: "2027-10-13", adults: 2, children: null, amount: { cents: 48_000, currency: "EUR", kind: "GUEST_TOTAL" as const } };
    expect(contentKey(p)).toBe(contentKey({ ...p }));
    expect(contentKey({ ...p, checkOut: "2027-10-14" })).not.toBe(contentKey(p));
    expect(contentKey({ ...p, kind: "MODIFICATION" })).not.toBe(contentKey(p));
    expect(contentKey({ ...p, code: null })).toBeNull();
    expect(contentKey({ ...p, platform: null })).toBeNull();
  });
});
