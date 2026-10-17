import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/server/auth";
import { cancelBooking, createBooking, listBookings, quoteStay } from "@/lib/server/bookings";
import { bookedRanges, cardsByIds, getListing, homeSections, listingExists, searchHomes } from "@/lib/server/catalog";
import { db } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { orgIdBySlug, publicOrgSlug } from "@/lib/server/org";
import { createReview } from "@/lib/server/reviews";
import { mergeWishlist, saveListing, wishlistIds } from "@/lib/server/wishlist";
import { parseSearchQuery } from "@/lib/search/params";
import { day, findHome, makeUser, sigmaOrgId } from "./helpers";

const sigma = await sigmaOrgId();
const stay = (listingId: string, from: number, to: number) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  adults: 1,
  children: 0,
  infants: 0,
  pets: 0,
});

describe("roles", () => {
  it("defaults to GUEST with no organization", async () => {
    const u = await makeUser("Plain");
    expect(u).toMatchObject({ role: "GUEST", organizationId: null, phone: null });
  });

  it("refuses team roles without an organization (users_staff_organization_check)", async () => {
    for (const role of ["ADMIN", "AGENT", "OWNER"] as const) {
      await expect(
        db.user.create({ data: { name: role, email: `${role.toLowerCase()}-${Date.now()}@test.sigma.test`, role } }),
      ).rejects.toThrow(/users_staff_organization_check|23514/);
      const ok = await db.user.create({
        data: { name: role, email: `${role.toLowerCase()}-ok-${Date.now()}@test.sigma.test`, role, organizationId: sigma },
      });
      expect(ok.role).toBe(role);
      // Nor can a member be detached from their organization afterwards.
      await expect(db.user.update({ where: { id: ok.id }, data: { organizationId: null } })).rejects.toThrow();
    }
  });

  it("seeds Sigma's three associés as ADMIN and two field agents, the public organization by slug", async () => {
    expect(publicOrgSlug()).toBe("sigma");
    const org = await db.organization.findUniqueOrThrow({ where: { slug: "sigma" } });
    expect(org).toMatchObject({ id: sigma, name: "Sigma", defaultCommissionBps: 2000 });
    const admins = await db.user.findMany({ where: { role: "ADMIN", email: { endsWith: "@demo.sigma.test" } }, orderBy: { name: "asc" } });
    expect(admins.map((u) => [u.name, u.organizationId])).toEqual([
      ["Amine", sigma],
      ["Felicia", sigma],
      ["Othman", sigma],
    ]);
    expect(await db.user.count({ where: { role: "AGENT", organizationId: sigma, email: { endsWith: "@demo.sigma.test" } } })).toBe(2);
    // Owners are Sigma members too; every demo listing and booking is Sigma's.
    expect(await db.user.count({ where: { role: "OWNER", email: { endsWith: "@demo.sigma.test" }, organizationId: { not: sigma } } })).toBe(0);
    expect(await db.user.count({ where: { role: "OWNER", organizationId: sigma, email: { endsWith: "@demo.sigma.test" } } })).toBe(8);
    expect(await db.listing.count({ where: { organizationId: { not: sigma } } })).toBe(0);
    expect(await db.booking.count({ where: { organizationId: { not: sigma } } })).toBe(0);
  });
});

describe("sign-up never sets a role or an organization", () => {
  const signUp = (body: Record<string, unknown>) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      }),
    );

  it("ignores role and organizationId sent by the client", async () => {
    const email = `signup-${Date.now()}@test.sigma.test`;
    const res = await signUp({ name: "Intrus", email, password: "motdepasse-test", role: "ADMIN", organizationId: sigma });
    expect(res.status, await res.clone().text()).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "GUEST", organizationId: null });
    // Nor does the session claim otherwise.
    const body = (await res.json()) as { user: { role?: string; organizationId?: string | null } };
    expect(body.user.role ?? "GUEST").toBe("GUEST");
    expect(body.user.organizationId ?? null).toBeNull();
  });

  it("can't promote itself later through update-user", async () => {
    const email = `signup-upd-${Date.now()}@test.sigma.test`;
    const res = await signUp({ name: "Patient", email, password: "motdepasse-test" });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const upd = await auth.handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
        body: JSON.stringify({ role: "ADMIN", organizationId: sigma }),
      }),
    );
    expect(upd.status).toBeGreaterThanOrEqual(400);
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ role: "GUEST", organizationId: null });
  });
});

describe("organizations never see each other's data", () => {
  let other: string;
  let otherListing: string;
  let otherBooking: string;
  let otherGuest: string;
  let otherAdmin: string;
  let otherOwner: string;
  let sigmaBooking: string;
  let sigmaGuest: string;
  const slug = `iso-${Date.now()}`;

  beforeAll(async () => {
    other = (await db.organization.create({ data: { name: "Autre conciergerie", slug } })).id;
    otherAdmin = (await db.user.create({ data: { name: "Admin B", email: `${slug}-admin@test.sigma.test`, role: "ADMIN", organizationId: other } })).id;
    otherOwner = (await db.user.create({ data: { name: "Owner B", email: `${slug}-owner@test.sigma.test`, role: "OWNER", organizationId: other } })).id;
    const place = await db.place.findUniqueOrThrow({ where: { slug: "hivernage" } });
    // Same neighbourhood, a better rating and price than anything Sigma has: it would lead every list if it leaked.
    const l = await db.listing.create({
      data: {
        organizationId: other,
        category: "HOME",
        propertyType: "VILLA",
        title: "Villa de l'autre organisation",
        description: "Ne doit jamais apparaître chez Sigma.",
        placeId: place.id,
        ownerId: otherOwner,
        address: "1 rue de test, Hivernage, Marrakech",
        lat: place.lat,
        lng: place.lng,
        maxGuests: 16,
        bedrooms: 8,
        beds: 8,
        bathrooms: 4,
        priceCents: 10_000,
        isGuestFavorite: true,
        ratingAvg: 5,
        reviewCount: 99,
        amenities: { create: [{ amenityId: "piscine" }, { amenityId: "animaux" }] },
        photos: { create: [{ url: "https://picsum.photos/seed/iso/720/684", position: 0 }] },
      },
    });
    otherListing = l.id;
    otherGuest = (await makeUser("GuestB")).id;
    otherBooking = (await createBooking(other, otherGuest, stay(otherListing, 280, 283))).id;

    sigmaGuest = (await makeUser("GuestA")).id;
    const home = await findHome({ place: "hivernage" });
    sigmaBooking = (await createBooking(sigma, sigmaGuest, stay(home.id, 290, 292))).id;
  });

  afterAll(async () => {
    await db.wishlistItem.deleteMany({ where: { listingId: otherListing } });
    await db.booking.deleteMany({ where: { organizationId: other } });
    await db.listing.deleteMany({ where: { organizationId: other } });
    await db.user.deleteMany({ where: { organizationId: other } });
    await db.organization.delete({ where: { id: other } });
  });

  it("the other organization's listing is real: it works in its own organization", async () => {
    expect(await orgIdBySlug(slug)).toBe(other);
    expect(await getListing(other, otherListing)).toMatchObject({ id: otherListing });
    expect((await searchHomes(other, "hivernage", parseSearchQuery({}))).cards.map((c) => c.id)).toEqual([otherListing]);
    expect(await listBookings(other, otherGuest)).toHaveLength(1);
  });

  it("never appears in Sigma's search or homepage", async () => {
    const all = await searchHomes(sigma, "partout", parseSearchQuery({ adults: "16", pets: "1" }));
    expect(all.cards.map((c) => c.id)).not.toContain(otherListing);
    // Even pinned by id.
    const pinned = await searchHomes(sigma, "hivernage", parseSearchQuery({ pinned: otherListing }));
    expect(pinned.cards.map((c) => c.id)).not.toContain(otherListing);
    for (const tab of ["all", "homes", "experiences"] as const) {
      const ids = (await homeSections(sigma, tab, Date.now())).flatMap((s) => (s.kind === "listings" ? s.cards.map((c) => c.id) : []));
      expect(ids).not.toContain(otherListing);
    }
  });

  it("is not found from Sigma: detail, availability, quote, booking", async () => {
    expect(await getListing(sigma, otherListing)).toBeNull();
    expect(await listingExists(sigma, otherListing)).toBe(false);
    expect(await bookedRanges(sigma, otherListing, new Date(Date.now()), new Date(Date.now() + 400 * 86_400_000))).toEqual([]);
    await expect(quoteStay(sigma, otherListing, stay(otherListing, 300, 302))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createBooking(sigma, sigmaGuest, stay(otherListing, 300, 302))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.booking.count({ where: { listingId: otherListing, organizationId: sigma } })).toBe(0);
  });

  it("can't be saved, merged or listed in a Sigma wishlist", async () => {
    const u = await makeUser("Saver");
    await expect(saveListing(sigma, u.id, otherListing)).rejects.toBeInstanceOf(AppError);
    expect(await mergeWishlist(sigma, u.id, [otherListing])).toEqual([]);
    expect(await cardsByIds(sigma, [otherListing])).toEqual([]);
    // A row saved in the other organization's context stays out of Sigma's list.
    await saveListing(other, u.id, otherListing);
    expect(await wishlistIds(other, u.id)).toEqual([otherListing]);
    expect(await wishlistIds(sigma, u.id)).toEqual([]);
  });

  it("can't be reviewed from Sigma", async () => {
    await expect(createReview(sigma, otherGuest, otherListing, { rating: 5, body: "Avis venu d'ailleurs, refusé." })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps trips apart: Sigma's trips don't show the other organization's booking, and the reverse", async () => {
    expect(await listBookings(sigma, otherGuest)).toEqual([]);
    expect((await listBookings(other, sigmaGuest)).map((b) => b.id)).not.toContain(sigmaBooking);
    await expect(cancelBooking(sigma, otherGuest, otherBooking)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a member of the other organization can't read or cancel Sigma's booking", async () => {
    // In their own organization's context, and in Sigma's (where they are not the guest).
    expect(await listBookings(other, otherAdmin)).toEqual([]);
    await expect(cancelBooking(other, otherAdmin, sigmaBooking)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelBooking(other, sigmaGuest, sigmaBooking)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelBooking(sigma, otherAdmin, sigmaBooking)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.booking.findUniqueOrThrow({ where: { id: sigmaBooking } })).status).toBe("CONFIRMED");
  });

  it("the database refuses a booking filed under another organization than its listing", async () => {
    const home = await findHome({ place: "gueliz" });
    await expect(
      db.booking.create({
        data: {
          organizationId: other,
          listingId: home.id,
          guestId: otherGuest,
          checkIn: new Date(`${day(310)}T00:00:00Z`),
          checkOut: new Date(`${day(312)}T00:00:00Z`),
          adults: 1,
          nightlyCents: 100,
          cleaningFeeCents: 0,
          serviceFeeCents: 0,
          totalCents: 100,
        },
      }),
    ).rejects.toThrow();
  });
});
