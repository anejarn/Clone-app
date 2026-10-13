/**
 * Resets demo data. Safe to re-run: it clears catalogue and activity tables first.
 * Users who signed up (no demo.nidou.fr email) are kept, but their bookings, reviews and wishlist items
 * on demo listings are removed with them.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { nightsBetween, priceBreakdown } from "../lib/pricing";
import { AMENITIES, buildBookings, buildFixtures } from "./fixtures";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const { places, hosts, guests, listings, reviews } = buildFixtures();
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const bookings = buildBookings(listings, guests, today);

  await prisma.$transaction([
    prisma.wishlistItem.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.review.deleteMany(),
    prisma.listingAmenity.deleteMany(),
    prisma.photo.deleteMany(),
    prisma.listing.deleteMany(),
    prisma.amenity.deleteMany(),
    prisma.place.deleteMany(),
    prisma.user.deleteMany({ where: { email: { endsWith: "@demo.nidou.fr" } } }),
  ]);

  await prisma.user.createMany({ data: [...hosts, ...guests].map((u) => ({ ...u, emailVerified: true })) });
  await prisma.place.createMany({ data: places });
  const placeIds = new Map((await prisma.place.findMany({ select: { id: true, slug: true } })).map((p) => [p.slug, p.id]));
  await prisma.amenity.createMany({ data: AMENITIES.map(([id, label, icon, group]) => ({ id, label, icon, group })) });

  // Rating aggregates are computed here once; lib/server/reviews.ts keeps them current afterwards.
  const stats = new Map<string, { sum: number; count: number }>();
  for (const r of reviews) {
    const s = stats.get(r.listingId) ?? { sum: 0, count: 0 };
    s.sum += r.rating;
    s.count += 1;
    stats.set(r.listingId, s);
  }

  await prisma.listing.createMany({
    data: listings.map(({ photos, amenities, placeSlug, ...l }) => {
      const s = stats.get(l.id);
      return {
        ...l,
        placeId: placeIds.get(placeSlug)!,
        reviewCount: s?.count ?? 0,
        ratingAvg: s ? Math.round((s.sum / s.count) * 100) / 100 : null,
      };
    }),
  });
  await prisma.photo.createMany({
    data: listings.flatMap((l) => l.photos.map((url, position) => ({ listingId: l.id, url, position }))),
  });
  await prisma.listingAmenity.createMany({
    data: listings.flatMap((l) => l.amenities.map((amenityId) => ({ listingId: l.id, amenityId }))),
  });
  await prisma.review.createMany({ data: reviews });

  const byId = new Map(listings.map((l) => [l.id, l]));
  await prisma.booking.createMany({
    data: bookings.map((b) => {
      const l = byId.get(b.listingId)!;
      const p = priceBreakdown(l.priceCents, nightsBetween(b.checkIn, b.checkOut), l.cleaningFeeCents);
      return {
        ...b,
        nightlyCents: l.priceCents,
        cleaningFeeCents: p.cleaningFeeCents,
        serviceFeeCents: p.serviceFeeCents,
        totalCents: p.totalCents,
      };
    }),
  });

  console.log(
    `Seeded ${places.length} places, ${hosts.length + guests.length} users, ${listings.length} listings, ` +
      `${reviews.length} reviews, ${bookings.length} bookings.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
