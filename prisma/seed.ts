/**
 * Resets demo data. Safe to re-run: it clears catalogue and activity tables first.
 * Users who signed up (no demo.sigma.test email) are kept, but their bookings, reviews and wishlist items
 * on demo listings are removed with them. Amounts are centimes of dirham (MAD).
 * Everything belongs to the Sigma organization (created by the organizations_and_roles migration, upserted here):
 * its team, its owners (propriétaires) and their listings, which take the organization's default commission
 * (0 for sub-lets).
 * Bookings: direct stays of demo guest accounts, platform bookings (Airbnb, Booking.com, Agoda, Trip.com) of guests
 * without an account, and a few owner blocks; none overlap (prisma/fixtures.ts). Seasons and events (Prix) for a
 * selection of homes; booking amounts are priced with them by the pricing engine.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { PrismaClient } from "../lib/generated/prisma/client";
import { priceStay, type PricingRule } from "../lib/pricing";
import {
  AMENITIES,
  buildBookings,
  buildChannelBookings,
  buildFixtures,
  buildLicenses,
  buildPriceRules,
  DEMO_BACKUP_CODES,
  DEMO_LOGINS,
  DEMO_PASSWORD,
  DEMO_TOTP_SECRET,
  SIGMA_ORG,
} from "./fixtures";

const DEMO_DOMAINS = ["@demo.sigma.test", "@demo.nidou.fr"];
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const { places, staff, owners, guests, listings, reviews } = buildFixtures();
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const bookings = buildBookings(listings, guests, today);
  const { platform, ownerBlocks } = buildChannelBookings(listings, today);
  const licenses = new Map(buildLicenses(listings, today).map((l) => [l.listingId, l]));

  await prisma.$transaction([
    prisma.priceRule.deleteMany(),
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
    select: { id: true, defaultCommissionBps: true },
  });
  const organizationId = org.id;

  await prisma.user.createMany({
    data: [
      ...[...staff, ...owners].map((u) => ({ ...u, emailVerified: true, organizationId })),
      ...guests.map((u) => ({ ...u, emailVerified: true })),
    ],
  });
  await seedDemoLogins();
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
        // Sub-lets earn Sigma the rent margin, not a commission (listings_sublease_commission_check).
        commissionBps: l.managementType === "SUBLEASE" ? 0 : org.defaultCommissionBps,
        licenseNumber: licenses.get(l.id)?.licenseNumber ?? null,
        licenseExpiresAt: licenses.get(l.id)?.licenseExpiresAt ?? null,
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
  await prisma.review.createMany({ data: reviews.map((r) => ({ ...r, organizationId })) });

  // Seasons and events (Prix), then the bookings priced by the same engine as the site (lib/pricing/engine.ts).
  const rules = buildPriceRules(listings);
  await prisma.priceRule.createMany({
    data: rules.map(({ listingIds, ...r }) => ({ ...r, organizationId, adjustmentType: "PERCENT" as const, allListings: listingIds === null })),
  });
  await prisma.priceRuleListing.createMany({
    data: rules.flatMap((r) => (r.listingIds ?? []).map((listingId) => ({ ruleId: r.id, listingId, organizationId }))),
  });
  const engineRules: PricingRule[] = rules.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    recurring: r.recurring,
    adjustment: { type: "PERCENT", bps: r.percentBps },
    minNights: r.minNights,
    priority: r.priority,
    listingIds: r.listingIds,
    createdAt: "2026-10-01T00:00:00.000Z",
  }));
  const byId = new Map(listings.map((l) => [l.id, l]));
  const amounts = (b: { listingId: string; checkIn: Date; checkOut: Date }) => {
    const p = priceStay(byId.get(b.listingId)!, engineRules, b.checkIn, b.checkOut);
    // nightlyCents: the average of the nights (Booking.nightlyCents); the total is the exact sum.
    return { nightlyCents: p.averageNightlyCents, cleaningFeeCents: p.cleaningFeeCents, serviceFeeCents: p.serviceFeeCents, totalCents: p.totalCents };
  };
  await prisma.booking.createMany({
    data: bookings.map((b) => ({ ...b, organizationId, source: "DIRECT" as const, ...amounts(b) })),
  });
  // Platform bookings carry the price as Sigma computes it; the platform's own figures (lot 7) come later.
  await prisma.booking.createMany({
    data: platform.map((b) => ({ ...b, organizationId, ...amounts(b) })),
  });
  // Owner blocks: dates only (bookings_owner_block_check).
  await prisma.booking.createMany({
    data: ownerBlocks.map((b) => ({ ...b, organizationId, source: "OWNER" as const, adults: 0 })),
  });

  console.log(
    `Seeded organization "${SIGMA_ORG.slug}", ${places.length} places, ${staff.length + owners.length + guests.length} users ` +
      `(${staff.length} staff, ${owners.length} owners), ${listings.length} listings ` +
      `(${listings.filter((l) => l.managementType === "SUBLEASE").length} sub-let), ` +
      `${reviews.length} reviews, ${bookings.length + platform.length + ownerBlocks.length} bookings ` +
      `(${bookings.length} direct, ${platform.length} from platforms, ${ownerBlocks.length} owner blocks), ${rules.length} price rules.`,
  );
}

/**
 * Passwords (and, for two staff members, double authentification) for a few demo accounts, so the back-office can
 * be tried and tested end to end. Dev and test databases only. The TOTP secret and backup codes are encrypted with
 * BETTER_AUTH_SECRET exactly as Better Auth stores them, so the app reading this database must use the same secret
 * (the test suites pass theirs to the seed).
 */
async function seedDemoLogins() {
  if (process.env.NODE_ENV === "production") {
    console.warn("NODE_ENV=production: demo accounts get no password and no double authentification.");
    return;
  }
  const password = await hashPassword(DEMO_PASSWORD);
  await prisma.account.createMany({
    data: DEMO_LOGINS.map(({ userId }) => ({ id: `acc_${userId}`, accountId: userId, providerId: "credential", userId, password })),
  });
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) {
    console.warn("BETTER_AUTH_SECRET is not set: demo staff get no double authentification (they will be asked to enroll).");
    return;
  }
  const withTotp = DEMO_LOGINS.filter((l) => l.totp).map((l) => l.userId);
  const backupCodes = await symmetricEncrypt({ key, data: JSON.stringify(DEMO_BACKUP_CODES) });
  for (const userId of withTotp) {
    const secret = await symmetricEncrypt({ key, data: DEMO_TOTP_SECRET });
    await prisma.twoFactor.create({ data: { id: `tf_${userId}`, userId, secret, backupCodes, verified: true } });
  }
  await prisma.user.updateMany({ where: { id: { in: withTotp } }, data: { twoFactorEnabled: true } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
