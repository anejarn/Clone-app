import { afterAll, beforeAll } from "vitest";

/**
 * Test hygiene (setup file of the integration project, runs around every test file): the accounts a file creates
 * (makeUser, makeMember, sign-ups — all under the reserved test domain @test.sigma.test) are deleted when the file
 * ends, with the rows that only exist through them, so that test runs no longer pile up accounts in the test database
 * (some 2 750 of them had slowed Utilisateurs down). The accounts present when the file starts are noted first, so a
 * file only ever deletes its own (files run one at a time: fileParallelism false), whatever its fake clock says.
 *
 * Rows held by a file's accounts and removed here (the files found leaving accounts behind — accounts, bookings,
 * booking-sources, catalog, http, listings, organizations, timezones — book or review seeded homes as test guests):
 * - the bookings they made as guests (with what cascades from a booking: tasks, split, travellers, guide links…;
 *   their conciergerie requests first). Journal entries already posted for them stay: the journal is append-only;
 * - the reviews they wrote, and the rating of the homes reviewed is recomputed as lib/server/reviews.ts does.
 * Homes, statements, payouts and documents of a file's own organizations are removed by that file's afterAll (it runs
 * before this one). An account still held after that is reported and the file fails, rather than being left behind.
 * The seed's demo reset (prisma/seed.ts) also deletes the leftovers of an interrupted run.
 */

const TEST_DOMAIN = "@test.sigma.test";
let before = new Set<string>();

async function testAccounts(): Promise<{ id: string; email: string }[]> {
  const { db } = await import("@/lib/server/db");
  return db.user.findMany({ where: { email: { endsWith: TEST_DOMAIN } }, select: { id: true, email: true } });
}

beforeAll(async () => {
  before = new Set((await testAccounts()).map((u) => u.id));
});

afterAll(async () => {
  const { db } = await import("@/lib/server/db");
  const users = (await testAccounts()).filter((u) => !before.has(u.id));
  if (!users.length) return;
  const ids = users.map((u) => u.id);

  const bookings = (await db.booking.findMany({ where: { guestId: { in: ids } }, select: { id: true } })).map((b) => b.id);
  const reviewed = await db.review.findMany({ where: { authorId: { in: ids } }, select: { listingId: true, organizationId: true }, distinct: ["listingId"] });
  await db.$transaction(async (tx) => {
    if (bookings.length) {
      await tx.serviceRequest.deleteMany({ where: { bookingId: { in: bookings } } });
      await tx.booking.deleteMany({ where: { id: { in: bookings } } });
    }
    await tx.review.deleteMany({ where: { authorId: { in: ids } } });
    for (const r of reviewed) {
      const agg = await tx.review.aggregate({ where: { organizationId: r.organizationId, listingId: r.listingId }, _avg: { rating: true }, _count: true });
      await tx.listing.update({ where: { id: r.listingId }, data: { reviewCount: agg._count, ratingAvg: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 100) / 100 } });
    }
  });

  try {
    await db.user.deleteMany({ where: { id: { in: ids } } });
  } catch {
    const held: string[] = [];
    for (const u of users) {
      try {
        await db.user.deleteMany({ where: { id: u.id } });
      } catch (e) {
        held.push(`${u.email}: ${(e as Error).message.split("\n").filter(Boolean).pop()}`);
      }
    }
    if (held.length) throw new Error(`test accounts left behind (a row still uses them: clean it up in the file's afterAll):\n${held.join("\n")}`);
  }
});
