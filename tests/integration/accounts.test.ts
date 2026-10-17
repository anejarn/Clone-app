import { describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { createReview } from "@/lib/server/reviews";
import { mergeWishlist, saveListing, unsaveListing, wishlistIds } from "@/lib/server/wishlist";
import { findHome, makeUser, sigmaOrgId } from "./helpers";

const org = await sigmaOrgId();

describe("wishlist", () => {
  it("saves idempotently, newest first, and unsaves", async () => {
    const u = await makeUser();
    const [a, b] = await Promise.all([findHome({ place: "hivernage" }), findHome({ place: "gueliz" })]);
    await saveListing(org, u.id, a.id);
    await saveListing(org, u.id, b.id);
    await saveListing(org, u.id, a.id);
    expect(await wishlistIds(org, u.id)).toEqual([b.id, a.id]);
    await unsaveListing(org, u.id, b.id);
    await unsaveListing(org, u.id, b.id);
    expect(await wishlistIds(org, u.id)).toEqual([a.id]);
  });

  it("rejects unknown listings on save, ignores them on merge", async () => {
    const u = await makeUser();
    const a = await findHome({ place: "medina" });
    await expect(saveListing(org, u.id, "nope")).rejects.toBeInstanceOf(AppError);
    expect(await mergeWishlist(org, u.id, [a.id, "nope", a.id])).toEqual([a.id]);
  });

  it("keeps lists per user", async () => {
    const [u1, u2] = await Promise.all([makeUser(), makeUser()]);
    await saveListing(org, u1.id, (await findHome()).id);
    expect(await wishlistIds(org, u2.id)).toEqual([]);
  });
});

describe("reviews", () => {
  it("needs a completed stay, updates the rating, once per stay", async () => {
    const guest = await makeUser("Reviewer");
    const home = await findHome({ place: "agdal" });
    const input = { rating: 1, body: "Très déçu par le bruit la nuit." };
    await expect(createReview(org, guest.id, home.id, input)).rejects.toMatchObject({ code: "NO_STAY" });

    const past = (d: number) => new Date(Date.now() - d * 86_400_000);
    await db.booking.create({
      data: { organizationId: org, listingId: home.id, guestId: guest.id, checkIn: past(10), checkOut: past(7), adults: 1, nightlyCents: 100, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 100 },
    });
    const before = await db.listing.findUniqueOrThrow({ where: { id: home.id } });
    await createReview(org, guest.id, home.id, input);
    const after = await db.listing.findUniqueOrThrow({ where: { id: home.id } });
    expect(after.reviewCount).toBe(before.reviewCount + 1);
    const agg = await db.review.aggregate({ where: { listingId: home.id }, _avg: { rating: true } });
    expect(after.ratingAvg).toBeCloseTo(agg._avg.rating!, 2);
    await expect(createReview(org, guest.id, home.id, input)).rejects.toMatchObject({ code: "ALREADY_REVIEWED" });
  });
});
