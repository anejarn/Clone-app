import { createHash } from "node:crypto";
import type { PlatformSource } from "../../admin/booking-sources";
import { fold } from "./text";
import type { ParsedBookingEmail } from "./types";

/**
 * Which home a booking e-mail is about (Lot 7b), and the keys that make its processing idempotent. Pure.
 *
 * Matching, in order, among the organization's homes (the first rule that gives exactly one home wins; two or more →
 * ambiguous, sent to the manual queue; none → manual queue):
 * 1. the platform's listing / property id written on the home's feed for that platform (ChannelFeed.platformListingId);
 * 2. the platform's title of the home written on that feed (platformListingName), compared without case, accents
 *    or punctuation;
 * 3. the Sigma title of the home, compared the same way;
 * 4. one name containing the other (at least 6 characters), feed names first, then Sigma titles;
 * 5. the organization has a single home.
 */

export interface ListingCandidate {
  listingId: string;
  title: string;
  /** The home's feeds: the platform's names of the home, per platform. */
  feeds: readonly { source: PlatformSource; platformListingId: string | null; platformListingName: string | null }[];
}

export type ListingMatch =
  | { kind: "match"; listingId: string; by: "PLATFORM_ID" | "PLATFORM_NAME" | "TITLE" | "PARTIAL_NAME" | "ONLY_HOME" }
  | { kind: "ambiguous"; listingIds: string[] }
  | { kind: "none" };

/** "Riad Test – Jasmin (Médina)" → "riad test jasmin medina". */
export function normalizeName(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const normalizeId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchListing(candidates: readonly ListingCandidate[], platform: PlatformSource | null, listing: ParsedBookingEmail["listing"]): ListingMatch {
  const decide = (ids: string[], by: Extract<ListingMatch, { kind: "match" }>["by"]): ListingMatch | null => {
    const unique = [...new Set(ids)];
    if (unique.length === 1) return { kind: "match", listingId: unique[0], by };
    if (unique.length > 1) return { kind: "ambiguous", listingIds: unique };
    return null;
  };
  const feedsOf = (c: ListingCandidate) => c.feeds.filter((f) => f.source === platform);
  if (listing.platformId && platform) {
    const id = normalizeId(listing.platformId);
    const r = decide(
      candidates.filter((c) => feedsOf(c).some((f) => f.platformListingId && normalizeId(f.platformListingId) === id)).map((c) => c.listingId),
      "PLATFORM_ID",
    );
    if (r) return r;
  }
  const name = listing.name ? normalizeName(listing.name) : "";
  if (name) {
    if (platform) {
      const r = decide(
        candidates.filter((c) => feedsOf(c).some((f) => f.platformListingName && normalizeName(f.platformListingName) === name)).map((c) => c.listingId),
        "PLATFORM_NAME",
      );
      if (r) return r;
    }
    const byTitle = decide(candidates.filter((c) => normalizeName(c.title) === name).map((c) => c.listingId), "TITLE");
    if (byTitle) return byTitle;
    if (name.length >= 6) {
      const contains = (other: string) => other.length >= 6 && (other.includes(name) || name.includes(other));
      const byFeed = platform
        ? decide(candidates.filter((c) => feedsOf(c).some((f) => f.platformListingName && contains(normalizeName(f.platformListingName)))).map((c) => c.listingId), "PARTIAL_NAME")
        : null;
      if (byFeed) return byFeed;
      const byPartTitle = decide(candidates.filter((c) => contains(normalizeName(c.title))).map((c) => c.listingId), "PARTIAL_NAME");
      if (byPartTitle) return byPartTitle;
    }
  }
  if (candidates.length === 1) return { kind: "match", listingId: candidates[0].listingId, by: "ONLY_HOME" };
  return { kind: "none" };
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * The idempotency key of a message: its Message-ID (trimmed, without angle brackets, lower case: the same message
 * received twice by the webhook, or dropped again by hand), or the SHA-256 of the raw message when it has none.
 */
export function messageKey(messageId: string | null, rawSha256: string): string {
  const id = messageId?.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return id ? sha256(`mid:${id}`) : sha256(`raw:${rawSha256}`);
}

/**
 * The key of what an e-mail says (platform, kind, code, nights, guests, amount): the same e-mail forwarded twice (a
 * new Message-ID each time) has the same content key and is recorded as a duplicate. Null without a code.
 */
export function contentKey(p: Pick<ParsedBookingEmail, "platform" | "kind" | "code" | "checkIn" | "checkOut" | "adults" | "children" | "amount">): string | null {
  if (!p.platform || !p.code) return null;
  return sha256(["v1", p.platform, p.kind, p.code, p.checkIn ?? "", p.checkOut ?? "", p.adults ?? "", p.children ?? "", p.amount ? `${p.amount.cents}${p.amount.currency}${p.amount.kind}` : ""].join("|"));
}

export function rawHash(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}
