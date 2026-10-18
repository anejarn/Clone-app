import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Biens (Lot 2b) through the real server actions, signed in as each kind of visitor: next/headers is pointed at
 * the test session, next/cache's request-only calls are stubbed. Photos go to a temporary local store.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const { createListingAction, deletePhotoAction, movePhotoAction, updateListingAction, uploadPhotoAction } = await import("@/app/admin/biens/actions");
const { GET: media } = await import("@/app/media/[...key]/route");
const { getAdminListing, listAdminListings } = await import("@/lib/server/admin/listings");
const { cardsByIds, getListing, listingExists, searchHomes } = await import("@/lib/server/catalog");
const { quoteStay } = await import("@/lib/server/bookings");
const { saveListing } = await import("@/lib/server/wishlist");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { parseSearchQuery } = await import("@/lib/search/params");
const { day, makeUser, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

const sigma = await sigmaOrgId();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const TOKEN = `T${Date.now()}`;

let storeDir: string;
let admin: Headers;
let otherAdmin: Headers;
let otherOrg: string;
let otherListing: string;
let sigmaOwner: string;
let otherOwner: string;
let placeId: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

function valid(over: Record<string, string | string[]> = {}) {
  return {
    title: `Riad test ${TOKEN}`,
    description: "Riad rénové autour d'un patio.",
    propertyType: "RIAD",
    maxGuests: "4",
    bedrooms: "2",
    beds: "2",
    bathrooms: "1,5",
    placeId,
    address: `3 derb ${TOKEN}`,
    city: "Marrakech",
    lat: "31,6295",
    lng: "-7,9811",
    amenityIds: ["wifi", "climatisation"],
    houseRules: "Pas de fête",
    ownerId: sigmaOwner,
    managementType: "MANAGED",
    commission: "17,5",
    licenseNumber: "80-14/TEST/1",
    licenseExpiresAt: day(30),
    minNights: "2",
    price: "1 200,50",
    cleaningFee: "250",
    status: "DRAFT",
    ...over,
  };
}

const as = (h: Headers) => {
  ctx.headers = h;
};

/** Runs the create action; returns the new id from its redirect, or the returned state. */
async function create(values: Record<string, string | string[]>) {
  try {
    const state = await createListingAction({}, form(values));
    return { state };
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    const id = /\/admin\/biens\/([^?;]+)\?cree=1/.exec(digest)?.[1];
    if (!id) throw e;
    return { id };
  }
}

async function update(id: string, values: Record<string, string | string[]>) {
  try {
    return await updateListingAction(id, {}, form(values));
  } catch (e) {
    if (String((e as { digest?: string }).digest ?? "").includes(`/admin/biens/${id}?modifie=1`)) return { saved: true };
    throw e;
  }
}

const photoForm = (bytes: Uint8Array, name = "photo.png", type = "image/png") => {
  const f = new FormData();
  f.set("photo", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  return f;
};

async function newListing(over: Record<string, string | string[]> = {}) {
  as(admin);
  const r = await create(valid(over));
  if (!r.id) throw new Error(`create failed: ${JSON.stringify(r.state)}`);
  return r.id;
}

const filesInStore = async () => {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else out.push(join(d, e.name));
    }
  };
  await walk(storeDir);
  return out;
};

const mediaGet = (url: string, headers = new Headers()) =>
  media(new Request(`http://localhost:3100${url}`, { headers }), { params: Promise.resolve({ key: url.replace(/^\/media\//, "").split("/") }) });

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-uploads-"));
  setFileStorage(new LocalStorage(storeDir));
  placeId = (await db.place.findFirstOrThrow({ where: { slug: "medina" } })).id;
  sigmaOwner = (await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN}@test.sigma.test`, role: "OWNER", organizationId: sigma } })).id;
  createdUsers.push(sigmaOwner);
  admin = (await signedInMember({ role: "ADMIN", organizationId: sigma, twoFactor: true })).headers;

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `biens-${TOKEN.toLowerCase()}`, defaultCommissionBps: 1500 } })).id;
  otherOwner = (await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } })).id;
  otherAdmin = (await signedInMember({ role: "ADMIN", organizationId: otherOrg, twoFactor: true })).headers;
  otherListing = (
    await db.listing.create({
      data: { title: "Bien d'une autre organisation", description: "x", organizationId: otherOrg, placeId, ownerId: otherOwner, address: "x", lat: 0, lng: 0, maxGuests: 2, priceCents: 10_000, status: "DRAFT" },
    })
  ).id;

  const personas: [string, Role | null, boolean][] = [
    ["anonymous", null, false],
    ["guest", "GUEST", false],
    ["owner", "OWNER", false],
    ["agent", "AGENT", true],
    ["admin without 2FA", "ADMIN", false],
  ];
  for (const [name, role, twoFactor] of personas) {
    if (!role) refused.set(name, new Headers());
    else refused.set(name, (await signedInMember({ role, organizationId: role === "GUEST" ? null : sigma, twoFactor })).headers);
  }
});

beforeEach(() => as(admin));

afterAll(async () => {
  await db.listing.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { organizationId: sigma, title: { contains: TOKEN } }] } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("only admins of the organization may manage listings", () => {
  it("every action refuses anonymous visitors, guests, owners, agents and admins without 2FA, and changes nothing", async () => {
    const id = await newListing();
    const photo = await uploadPhotoAction(id, photoForm(PNG));
    expect(photo).toEqual({});
    const [p] = await db.photo.findMany({ where: { listingId: id } });
    const before = JSON.stringify(await getAdminListing(sigma, id));
    const count = await db.listing.count();
    const expected: Record<string, string> = {
      anonymous: "Connectez-vous pour continuer.",
      guest: "Accès refusé.",
      owner: "Accès refusé.",
      agent: "Accès refusé.",
      "admin without 2FA": "Activez la double authentification pour accéder à l'espace équipe.",
    };
    for (const [name, headers] of refused) {
      as(headers);
      const want = { error: expected[name] };
      expect(await createListingAction({}, form(valid())), name).toEqual(want);
      expect(await updateListingAction(id, {}, form(valid({ title: "Piraté" }))), name).toEqual(want);
      expect(await uploadPhotoAction(id, photoForm(PNG)), name).toEqual(want);
      expect(await movePhotoAction(id, p.id, "down"), name).toEqual(want);
      expect(await deletePhotoAction(id, p.id), name).toEqual(want);
    }
    expect(await db.listing.count()).toBe(count);
    expect(JSON.stringify(await getAdminListing(sigma, id))).toBe(before);
  });
});

describe("creating a listing", () => {
  it("stores the form in the caller's organization, amounts in centimes and basis points, as a draft", async () => {
    const id = await newListing();
    const l = await db.listing.findUniqueOrThrow({ where: { id }, include: { amenities: true } });
    expect(l).toMatchObject({
      organizationId: sigma,
      category: "HOME",
      status: "DRAFT",
      title: `Riad test ${TOKEN}`,
      propertyType: "RIAD",
      ownerId: sigmaOwner,
      managementType: "MANAGED",
      commissionBps: 1750,
      priceCents: 120_050,
      cleaningFeeCents: 25_000,
      minNights: 2,
      bathrooms: 1.5,
      lat: 31.6295,
      lng: -7.9811,
      city: "Marrakech",
      houseRules: "Pas de fête",
      licenseNumber: "80-14/TEST/1",
      licenseExpiresAt: new Date(`${day(30)}T00:00:00Z`),
    });
    expect(l.amenities.map((a) => a.amenityId).sort()).toEqual(["climatisation", "wifi"]);
  });

  it("an admin of another organization creates in theirs, never in Sigma's", async () => {
    as(otherAdmin);
    const r = await create(valid({ ownerId: otherOwner }));
    expect((await db.listing.findUniqueOrThrow({ where: { id: r.id! } })).organizationId).toBe(otherOrg);
  });

  it("the owner must be an OWNER of the same organization", async () => {
    const guest = await makeUser("Guest");
    createdUsers.push(guest.id);
    const agent = await db.user.create({ data: { name: "Agent", email: `agent-${TOKEN}@test.sigma.test`, role: "AGENT", organizationId: sigma } });
    createdUsers.push(agent.id);
    for (const ownerId of [otherOwner, guest.id, agent.id, "inconnu"]) {
      expect((await create(valid({ ownerId }))).state).toMatchObject({ error: "Le propriétaire doit être un compte propriétaire de l'organisation." });
    }
    // Nor can an admin of the other organization give a listing to Sigma's owner.
    as(otherAdmin);
    expect((await create(valid({ ownerId: sigmaOwner }))).state).toMatchObject({ error: expect.stringContaining("propriétaire") });
  });

  it("requires a commission for a mandate, and takes none on a sub-let", async () => {
    const missing = (await create(valid({ commission: "" }))).state!;
    expect(missing.fieldErrors?.commission).toBe("Commission : champ obligatoire");
    expect(missing.values).toMatchObject({ title: `Riad test ${TOKEN}`, commission: "" });
    expect((await create(valid({ commission: "120" }))).state!.fieldErrors?.commission).toMatch(/entre 0 et 100/);
    const sublet = await newListing({ managementType: "SUBLEASE", commission: "20" });
    expect((await db.listing.findUniqueOrThrow({ where: { id: sublet } })).commissionBps).toBe(0);
  });

  it("refuses invalid fields, unknown neighbourhoods and amenities, and publishing without a photo", async () => {
    const bad = (await create(valid({ price: "abc", maxGuests: "0" }))).state!;
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["maxGuests", "price"]);
    expect((await create(valid({ licenseExpiresAt: "" }))).state!.fieldErrors).toEqual({
      licenseExpiresAt: "Date d'expiration : obligatoire avec un numéro d'autorisation",
    });
    expect((await create(valid({ placeId: "inconnu" }))).state).toMatchObject({ error: "Quartier inconnu." });
    expect((await create(valid({ amenityIds: ["wifi", "inconnu"] }))).state).toMatchObject({ error: "Équipement inconnu." });
    expect((await create(valid({ status: "PUBLISHED" }))).state).toMatchObject({ error: "Ajoutez au moins une photo avant de publier le bien." });
    expect(await db.listing.count({ where: { organizationId: sigma, title: `Riad test ${TOKEN}`, status: "PUBLISHED" } })).toBe(0);
  });
});

describe("editing a listing", () => {
  it("replaces the fields and the amenities; publishing needs a photo; drafts stay off the public site", async () => {
    const id = await newListing();
    expect(await update(id, valid({ title: `Riad modifié ${TOKEN}`, amenityIds: ["piscine"], commission: "20", price: "990" }))).toEqual({ saved: true });
    const l = await db.listing.findUniqueOrThrow({ where: { id }, include: { amenities: true } });
    expect(l).toMatchObject({ title: `Riad modifié ${TOKEN}`, commissionBps: 2000, priceCents: 99_000, status: "DRAFT" });
    expect(l.amenities.map((a) => a.amenityId)).toEqual(["piscine"]);

    // A draft is nowhere on the public site.
    expect(await getListing(sigma, id)).toBeNull();
    expect(await listingExists(sigma, id)).toBe(false);
    expect(await cardsByIds(sigma, [id])).toEqual([]);
    expect((await searchHomes(sigma, "medina", parseSearchQuery({}))).cards.map((c) => c.id)).not.toContain(id);
    const stay = { listingId: id, checkIn: day(300), checkOut: day(303), adults: 1, children: 0, infants: 0, pets: 0 };
    await expect(quoteStay(sigma, id, stay)).rejects.toMatchObject({ status: 404 });
    const guest = await makeUser("Fan");
    createdUsers.push(guest.id);
    await expect(saveListing(sigma, guest.id, id)).rejects.toMatchObject({ status: 404 });

    expect(await update(id, valid({ status: "PUBLISHED" }))).toEqual({ error: "Ajoutez au moins une photo avant de publier le bien.", values: expect.any(Object) });
    expect(await uploadPhotoAction(id, photoForm(PNG))).toEqual({});
    expect(await update(id, valid({ status: "PUBLISHED" }))).toEqual({ saved: true });
    expect((await getListing(sigma, id))?.houseRules).toBe("Pas de fête");
    expect(await listingExists(sigma, id)).toBe(true);
    expect((await quoteStay(sigma, id, stay)).nights).toBe(3);
  });

  it("an id of another organization is not found, and nothing changes", async () => {
    const before = await db.listing.findUniqueOrThrow({ where: { id: otherListing } });
    expect(await update(otherListing, valid())).toEqual({ error: "Bien introuvable.", values: expect.any(Object) });
    expect(await uploadPhotoAction(otherListing, photoForm(PNG))).toEqual({ error: "Bien introuvable." });
    expect(await getAdminListing(sigma, otherListing)).toBeNull();
    expect(await db.listing.findUniqueOrThrow({ where: { id: otherListing } })).toEqual(before);
    expect(await db.photo.count({ where: { listingId: otherListing } })).toBe(0);
    // Malformed and unknown ids answer the same way.
    expect(await update("../x", valid())).toEqual({ error: "Bien introuvable." });
    expect(await uploadPhotoAction("inconnu", photoForm(PNG))).toEqual({ error: "Bien introuvable." });
  });

  it("experiences are not managed here", async () => {
    const exp = await db.listing.findFirstOrThrow({ where: { organizationId: sigma, category: "EXPERIENCE" } });
    expect(await getAdminListing(sigma, exp.id)).toBeNull();
    expect(await update(exp.id, valid())).toMatchObject({ error: "Bien introuvable." });
  });
});

describe("photos", () => {
  it("are checked by content, stored, ordered, set as cover and deleted with their file", async () => {
    const id = await newListing();
    const files = (await filesInStore()).length;
    expect(await uploadPhotoAction(id, photoForm(new TextEncoder().encode("pas une image"), "x.png"))).toEqual({ error: "Format non accepté : JPEG, PNG ou WebP uniquement." });
    expect(await uploadPhotoAction(id, photoForm(new Uint8Array(), "vide.png"))).toEqual({ error: "Choisissez une photo." });
    expect(await uploadPhotoAction(id, new FormData())).toEqual({ error: "Choisissez une photo." });
    expect((await filesInStore()).length).toBe(files);

    for (let i = 0; i < 3; i++) expect(await uploadPhotoAction(id, photoForm(PNG))).toEqual({});
    const order = async () => (await db.photo.findMany({ where: { listingId: id }, orderBy: { position: "asc" } })).map((p) => p.id);
    const [a, b, c] = await order();
    const stored = await db.photo.findMany({ where: { listingId: id } });
    expect(stored.every((p) => p.storageKey?.startsWith(`listings/${sigma}/${id}/`) && p.url === `/media/${p.storageKey}` && p.alt === `Riad test ${TOKEN}`)).toBe(true);
    expect((await filesInStore()).length).toBe(files + 3);

    expect(await movePhotoAction(id, c, "cover")).toEqual({});
    expect(await order()).toEqual([c, a, b]);
    expect(await movePhotoAction(id, c, "down")).toEqual({});
    expect(await order()).toEqual([a, c, b]);
    expect(await movePhotoAction(id, a, "up")).toEqual({});
    expect(await order()).toEqual([a, c, b]);
    expect(await movePhotoAction(id, b, "down")).toEqual({});
    expect(await order()).toEqual([a, c, b]);
    expect(await movePhotoAction(id, a, "sideways" as "up")).toEqual({ error: "Déplacement inconnu." });

    expect(await deletePhotoAction(id, c)).toEqual({});
    expect(await order()).toEqual([a, b]);
    expect((await db.photo.findMany({ where: { listingId: id }, orderBy: { position: "asc" } })).map((p) => p.position)).toEqual([0, 1]);
    expect((await filesInStore()).length).toBe(files + 2);

    // A published listing keeps one photo.
    expect(await update(id, valid({ status: "PUBLISHED" }))).toEqual({ saved: true });
    expect(await deletePhotoAction(id, a)).toEqual({});
    expect(await deletePhotoAction(id, b)).toEqual({ error: "Un bien publié garde au moins une photo : repassez-le en brouillon pour la supprimer." });

    // Another listing's photo, through this listing's id, is not found.
    const other = await newListing();
    expect(await deletePhotoAction(other, b)).toEqual({ error: "Photo introuvable." });
    expect(await movePhotoAction(other, b, "cover")).toEqual({ error: "Photo introuvable." });
  });

  it("of another organization can't be moved or deleted", async () => {
    as(otherAdmin);
    expect(await uploadPhotoAction(otherListing, photoForm(PNG))).toEqual({});
    const p = await db.photo.findFirstOrThrow({ where: { listingId: otherListing } });
    as(admin);
    expect(await deletePhotoAction(otherListing, p.id)).toEqual({ error: "Bien introuvable." });
    expect(await movePhotoAction(otherListing, p.id, "cover")).toEqual({ error: "Bien introuvable." });
    expect(await db.photo.count({ where: { id: p.id } })).toBe(1);
  });

  it("are served publicly once the listing is published, and to its organization's staff only while a draft", async () => {
    const id = await newListing();
    await uploadPhotoAction(id, photoForm(PNG));
    const { url } = await db.photo.findFirstOrThrow({ where: { listingId: id } });
    expect((await mediaGet(url)).status).toBe(404);
    expect((await mediaGet(url, otherAdmin)).status).toBe(404);
    expect((await mediaGet(url, refused.get("owner")!)).status).toBe(404);
    const staff = await mediaGet(url, admin);
    expect(staff.status).toBe(200);
    expect(staff.headers.get("content-type")).toBe("image/png");
    expect(staff.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await staff.arrayBuffer()).equals(PNG)).toBe(true);

    await update(id, valid({ status: "PUBLISHED" }));
    const pub = await mediaGet(url);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("cache-control")).toContain("public");

    for (const bad of ["/media/listings/../../etc/passwd", "/media/listings/x/y/unknown.png", "/media/other/thing.png"]) expect((await mediaGet(bad)).status, bad).toBe(404);
  });
});

describe("the list", () => {
  it("filters by text, status, management type and 80-14 status, around the 60-day alert", async () => {
    const today = new Date(`${day(0)}T00:00:00Z`);
    const make = async (suffix: string, over: Record<string, string | string[]>) => newListing({ title: `Liste ${suffix} ${TOKEN}`, ...over });
    const expired = await make("expirée", { licenseExpiresAt: day(-1) });
    const lastDay = await make("dernier jour", { licenseExpiresAt: day(0) });
    const at60 = await make("à 60 jours", { licenseExpiresAt: day(60) });
    const at61 = await make("à 61 jours", { licenseExpiresAt: day(61), managementType: "SUBLEASE" });
    const missing = await make("manquante", { licenseNumber: "", licenseExpiresAt: "" });
    const ids = async (f: Parameters<typeof listAdminListings>[1]) =>
      (await listAdminListings(sigma, { q: `Liste`, ...f }, today)).items.filter((i) => i.title.includes(TOKEN)).map((i) => i.id).sort();

    expect(await ids({ license: "EXPIRED" })).toEqual([expired]);
    expect(await ids({ license: "EXPIRING" })).toEqual([lastDay, at60].sort());
    expect(await ids({ license: "VALID" })).toEqual([at61]);
    expect(await ids({ license: "MISSING" })).toEqual([missing]);
    expect(await ids({ managementType: "SUBLEASE" })).toEqual([at61]);
    expect(await ids({ status: "PUBLISHED" })).toEqual([]);
    expect((await ids({ status: "DRAFT" })).length).toBe(5);

    const all = (await listAdminListings(sigma, { q: TOKEN.toLowerCase() }, today)).items;
    expect(all.find((i) => i.id === at60)?.license).toEqual({ status: "EXPIRING", daysLeft: 60 });
    expect(all.find((i) => i.id === at61)?.license).toEqual({ status: "VALID", daysLeft: 61 });
    // The address matches too.
    expect((await listAdminListings(sigma, { q: `derb ${TOKEN}` }, today)).total).toBeGreaterThanOrEqual(5);
  });

  it("shows only the caller's organization", async () => {
    const other = await listAdminListings(otherOrg, {});
    expect(other.items.map((i) => i.id)).toContain(otherListing);
    const orgs = await db.listing.findMany({ where: { id: { in: other.items.map((i) => i.id) } }, select: { organizationId: true } });
    expect(new Set(orgs.map((o) => o.organizationId))).toEqual(new Set([otherOrg]));
    const own = await listAdminListings(sigma, { q: "autre organisation" });
    expect(own.items.map((i) => i.id)).not.toContain(otherListing);
    expect((await listAdminListings(sigma, {})).total).toBeGreaterThan(100);
  });
});
