/**
 * Resets demo data. Safe to re-run: it clears catalogue and activity tables first.
 * Users who signed up (no demo.sigma.test email) are kept, but their bookings, reviews and wishlist items
 * on demo listings are removed with them. Amounts are centimes of dirham (MAD).
 * Everything belongs to the Sigma organization (created by the organizations_and_roles migration, upserted here).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { nightsBetween, priceBreakdown } from "../lib/pricing";
import { AMENITIES, buildBookings, buildFixtures, SIGMA_ORG } from "./fixtures";

const DEMO_DOMAINS = ["@demo.sigma.test", "@demo.nidou.fr"];
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const { places, staff, hosts, guests, listings, reviews } = buildFixtures();
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
    // Demo users only; @demo.nidou.fr is the fixture domain used before the rename to Sigma.
    prisma.user.deleteMany({ where: { OR: DEMO_DOMAINS.map((d) => ({ email: { endsWith: d } })) } }),
  ]);

  const org = await prisma.organization.upsert({
    where: { slug: SIGMA_ORG.slug },
    create: SIGMA_ORG,
    update: { name: SIGMA_ORG.name },
    select: { id: true },
  });
  const organizationId = org.id;

  await prisma.user.createMany({
    data: [
      ...staff.map((u) => ({ ...u, emailVerified: true, organizationId })),
      ...[...hosts, ...guests].map((u) => ({ ...u, emailVerified: true })),
    ],
  });
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
        organizationId,
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
        organizationId,
        nightlyCents: l.priceCents,
        cleaningFeeCents: p.cleaningFeeCents,
        serviceFeeCents: p.serviceFeeCents,
        totalCents: p.totalCents,
      };
    }),
  });

  console.log(
    `Seeded organization "${SIGMA_ORG.slug}", ${places.length} places, ${staff.length + hosts.length + guests.length} users ` +
      `(${staff.length} staff), ${listings.length} listings, ` +
      `${reviews.length} reviews, ${bookings.length} bookings.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
