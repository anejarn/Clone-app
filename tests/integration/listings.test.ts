import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBooking, minNightsMessage, quoteStay } from "@/lib/server/bookings";
import { cardsByIds, getListing, homeSections, searchHomes } from "@/lib/server/catalog";
import { db } from "@/lib/server/db";
import { defaultListingTerms, requireListingOwner } from "@/lib/server/listings";
import { parseSearchQuery } from "@/lib/search/params";
import { day, findHome, makeUser, sigmaOrgId, utcToday } from "./helpers";

const sigma = await sigmaOrgId();
const DAY = 86_400_000;
const stay = (listingId: string, from: number, to: number) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  adults: 1,
  children: 0,
  infants: 0,
  pets: 0,
});
let n = 0;
const email = (what: string) => `${what}-${Date.now()}-${++n}@test.sigma.test`;

/** Fields of a listing row the public site must never send. */
const PRIVATE_KEYS = ["owner", "ownerId", "commissionBps", "managementType", "address", "licenseNumber", "licenseExpiresAt"];

describe("seeded listings", () => {
  it("each belong to an owner (OWNER) of Sigma and take Sigma's default commission", async () => {
    const org = await db.organization.findUniqueOrThrow({ where: { id: sigma } });
    const listings = await db.listing.findMany({ where: { organizationId: sigma }, include: { owner: true } });
    expect(listings.length).toBeGreaterThan(100);
    for (const l of listings) {
      expect(l.owner).toMatchObject({ role: "OWNER", organizationId: sigma });
      expect(l.commissionBps).toBe(org.defaultCommissionBps);
      expect(l.address).toMatch(/Marrakech$/);
      expect([1, 2, 3]).toContain(l.minNights);
    }
    expect(new Set(listings.map((l) => l.ownerId)).size).toBe(8);
    expect(listings.filter((l) => l.managementType === "SUBLEASE").length).toBeGreaterThanOrEqual(3);
  });

  it("include riads in the Médina", async () => {
    const riads = await db.listing.findMany({ where: { organizationId: sigma, propertyType: "RIAD" }, include: { place: true } });
    expect(riads.length).toBeGreaterThanOrEqual(2);
    for (const r of riads) expect(r.place.slug).toBe("medina");
    // Shown as "Riad · Médina" on cards.
    const cards = await cardsByIds(sigma, riads.map((r) => r.id));
    expect(cards.map((c) => c.title)).toEqual(riads.map(() => "Riad · Médina"));
  });

  it("carry 80-14 authorisations: one expired, some expiring within 60 days", async () => {
    const homes = await db.listing.findMany({ where: { organizationId: sigma, category: "HOME" }, select: { licenseNumber: true, licenseExpiresAt: true } });
    const today = utcToday().getTime();
    const left = homes.flatMap((h) => (h.licenseExpiresAt ? [(h.licenseExpiresAt.getTime() - today) / DAY] : []));
    expect(left.filter((d) => d < 0)).toHaveLength(1);
    expect(left.filter((d) => d >= 0 && d <= 60).length).toBeGreaterThanOrEqual(3);
    expect(homes.some((h) => h.licenseNumber === null && h.licenseExpiresAt === null)).toBe(true);
  });
});

describe("database constraints on listings", () => {
  let owner: string;
  let base: Awaited<ReturnType<typeof findHome>>;
  const created: string[] = [];
  /** A copy of a seeded home (minus its id, timestamps and rating), owned by `owner`. */
  const row = (data: Record<string, unknown> = {}): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...base, title: "Contrainte", ownerId: owner, ...data };
    for (const key of ["id", "createdAt", "ratingAvg"]) delete copy[key];
    return copy;
  };
  const create = async (data: Record<string, unknown> = {}) => {
    const l = await db.listing.create({ data: row(data) as Parameters<typeof db.listing.create>[0]["data"] });
    created.push(l.id);
    return l;
  };

  beforeAll(async () => {
    base = await findHome();
    owner = (await db.user.create({ data: { name: "Owner C", email: email("owner-c"), role: "OWNER", organizationId: sigma } })).id;
  });
  afterAll(async () => {
    await db.listing.deleteMany({ where: { id: { in: created } } });
  });

  it("keeps the commission between 0 and 10000 basis points", async () => {
    for (const commissionBps of [-1, 10_001]) {
      await expect(create({ commissionBps })).rejects.toThrow(/listings_commission_bps_check|23514/);
    }
    for (const commissionBps of [0, 10_000]) expect((await create({ commissionBps })).commissionBps).toBe(commissionBps);
    const l = await create();
    await expect(db.listing.update({ where: { id: l.id }, data: { commissionBps: 12_000 } })).rejects.toThrow(/listings_commission_bps_check|23514/);
  });

  it("keeps the minimum stay at one night or more, defaulting to one", async () => {
    for (const minNights of [0, -2]) await expect(create({ minNights })).rejects.toThrow(/listings_min_nights_check|23514/);
    const rest = row();
    delete rest.minNights;
    const l = await db.listing.create({ data: rest as Parameters<typeof db.listing.create>[0]["data"] });
    created.push(l.id);
    expect(l).toMatchObject({ minNights: 1, managementType: "MANAGED" });
  });

  it("refuses an owner who isn't OWNER: guest, associé or agent", async () => {
    const guest = await makeUser("NotOwner");
    const admin = await db.user.create({ data: { name: "Admin", email: email("admin"), role: "ADMIN", organizationId: sigma } });
    const agent = await db.user.create({ data: { name: "Agent", email: email("agent"), role: "AGENT", organizationId: sigma } });
    // A guest has no organization: the (ownerId, organizationId) key refuses them before the role check.
    await expect(create({ ownerId: guest.id })).rejects.toThrow();
    for (const u of [admin, agent]) await expect(create({ ownerId: u.id })).rejects.toThrow(/listings_owner_role_check|23514/);
    const l = await create();
    await expect(db.listing.update({ where: { id: l.id }, data: { ownerId: admin.id } })).rejects.toThrow(/listings_owner_role_check|23514/);
  });

  it("refuses an owner from another organization, and moving an owner out of their listings' organization", async () => {
    const other = await db.organization.create({ data: { name: "Autre", slug: `owners-${Date.now()}` } });
    try {
      const foreign = await db.user.create({ data: { name: "Owner D", email: email("owner-d"), role: "OWNER", organizationId: other.id } });
      await expect(create({ ownerId: foreign.id })).rejects.toThrow();
      await create();
      await expect(db.user.update({ where: { id: owner }, data: { organizationId: other.id } })).rejects.toThrow();
      expect((await db.user.findUniqueOrThrow({ where: { id: owner } })).organizationId).toBe(sigma);
      await db.user.delete({ where: { id: foreign.id } });
    } finally {
      await db.organization.delete({ where: { id: other.id } });
    }
  });

  it("keeps an owner of listings an OWNER; without listings, the role can change", async () => {
    await create();
    await expect(db.user.update({ where: { id: owner }, data: { role: "AGENT" } })).rejects.toThrow(/listings_owner_role_check|23514/);
    const free = await db.user.create({ data: { name: "Owner E", email: email("owner-e"), role: "OWNER", organizationId: sigma } });
    expect((await db.user.update({ where: { id: free.id }, data: { role: "AGENT" } })).role).toBe("AGENT");
  });
});

describe("owner rules in code", () => {
  it("requireListingOwner accepts only an OWNER of the same organization", async () => {
    const owner = await db.listing.findFirstOrThrow({ where: { organizationId: sigma }, select: { ownerId: true } });
    expect(await requireListingOwner(sigma, owner.ownerId)).toBe(owner.ownerId);
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", organizationId: sigma } });
    const guest = await makeUser("Visitor");
    const other = await db.organization.create({ data: { name: "Autre", slug: `owners-code-${Date.now()}` } });
    try {
      const foreign = await db.user.create({ data: { name: "Owner F", email: email("owner-f"), role: "OWNER", organizationId: other.id } });
      for (const id of [admin.id, guest.id, foreign.id, "missing"]) {
        await expect(requireListingOwner(sigma, id)).rejects.toMatchObject({ status: 422, code: "INVALID_OWNER" });
      }
      // Sigma's owner isn't an owner for the other organization either.
      await expect(requireListingOwner(other.id, owner.ownerId)).rejects.toMatchObject({ code: "INVALID_OWNER" });
      await db.user.delete({ where: { id: foreign.id } });
    } finally {
      await db.organization.delete({ where: { id: other.id } });
    }
  });

  it("new listings take the organization's default commission", async () => {
    expect(await defaultListingTerms(sigma)).toEqual({ commissionBps: 2000, managementType: "MANAGED", minNights: 1 });
    const other = await db.organization.create({ data: { name: "Autre", slug: `terms-${Date.now()}`, defaultCommissionBps: 1500 } });
    try {
      expect((await defaultListingTerms(other.id)).commissionBps).toBe(1500);
    } finally {
      await db.organization.delete({ where: { id: other.id } });
    }
  });
});

describe("the public catalogue never exposes the owner", () => {
  it("not in the listing detail, nor its commission, address or authorisation", async () => {
    const row = await db.listing.findFirstOrThrow({ where: { organizationId: sigma, licenseNumber: { not: null } }, include: { owner: true } });
    const detail = await getListing(sigma, row.id);
    expect(detail).not.toBeNull();
    for (const key of PRIVATE_KEYS) expect(detail).not.toHaveProperty(key);
    const json = JSON.stringify(detail);
    for (const secret of [row.owner.id, row.owner.name, row.owner.email, row.address, row.licenseNumber!]) expect(json).not.toContain(secret);
    expect(detail).toMatchObject({ minNights: row.minNights });
  });

  it("not in cards: search, homepage, wishlists", async () => {
    const owners = await db.user.findMany({ where: { role: "OWNER", organizationId: sigma } });
    const json = JSON.stringify([
      await searchHomes(sigma, "partout", parseSearchQuery({})),
      await homeSections(sigma, "all", Date.now()),
      await cardsByIds(sigma, ["1000", "1032"]),
    ]);
    for (const o of owners) {
      expect(json).not.toContain(o.id);
      expect(json).not.toContain(o.name);
      expect(json).not.toContain(o.email);
    }
    for (const key of PRIVATE_KEYS) expect(json).not.toContain(`"${key}"`);
  });
});

describe("minimum stay", () => {
  it("says how many nights, singular or plural", () => {
    expect(minNightsMessage(1)).toBe("Ce logement se réserve pour 1 nuit minimum.");
    expect(minNightsMessage(2)).toBe("Ce logement se réserve pour 2 nuits minimum.");
    expect(minNightsMessage(3)).toBe("Ce logement se réserve pour 3 nuits minimum.");
  });

  it("quoteStay refuses a shorter stay with 422 MIN_NIGHTS, and accepts the minimum", async () => {
    const home = await findHome({ minNights: 3, guests: 1 });
    for (const [from, to] of [[200, 201], [200, 202]]) {
      await expect(quoteStay(sigma, home.id, stay(home.id, from, to))).rejects.toMatchObject({
        status: 422,
        code: "MIN_NIGHTS",
        message: "Ce logement se réserve pour 3 nuits minimum.",
      });
    }
    await expect(quoteStay(sigma, home.id, stay(home.id, 200, 203))).resolves.toMatchObject({ nights: 3 });
  });

  it("and so does booking", async () => {
    const home = await findHome({ minNights: 2, guests: 1 });
    const guest = await makeUser("Shortstay");
    await expect(createBooking(sigma, guest.id, stay(home.id, 205, 206))).rejects.toMatchObject({
      code: "MIN_NIGHTS",
      message: "Ce logement se réserve pour 2 nuits minimum.",
    });
    expect(await db.booking.count({ where: { listingId: home.id, guestId: guest.id } })).toBe(0);
    await expect(createBooking(sigma, guest.id, stay(home.id, 205, 207))).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("is checked through the quote API", async () => {
    const { GET } = await import("@/app/api/listings/[id]/quote/route");
    const home = await findHome({ minNights: 2, guests: 1 });
    const call = (from: number, to: number) =>
      GET(new Request(`http://localhost:3000/api/listings/${home.id}/quote?checkin=${day(from)}&checkout=${day(to)}&adults=1`), {
        params: Promise.resolve({ id: home.id }),
      } as Parameters<typeof GET>[1]);
    const short = await call(210, 211);
    expect(short.status).toBe(422);
    expect(await short.json()).toMatchObject({ error: { code: "MIN_NIGHTS", message: "Ce logement se réserve pour 2 nuits minimum." } });
    const ok = await call(210, 212);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ nights: 2 });
  });
});
