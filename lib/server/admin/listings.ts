import "server-only";
import { randomBytes } from "node:crypto";
import { licenseBounds, licenseState, type LicenseState, type LicenseStatus } from "@/lib/admin/license";
import type { ListingInput } from "@/lib/admin/listing-form";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ListingStatus, ManagementType } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { fileStorage } from "@/lib/storage";
import { checkPhoto, IMAGE_EXTENSION, MAX_PHOTOS_PER_LISTING } from "@/lib/storage/images";
import { db } from "../db";
import { AppError } from "../errors";
import { requireListingOwner } from "../listings";

/**
 * Back-office listing management (Biens, ADMIN only): list, detail, create, edit, photos. Every function takes the
 * caller's organization first (from lib/server/authz.ts) and only ever reads or writes that organization's rows:
 * a listing id of another organization is answered 404, as an unknown one. The back-office manages homes
 * (category HOME); experiences are not properties.
 */

const notFound = () => new AppError(404, "NOT_FOUND", "Bien introuvable.");
const homes = (organizationId: string) => ({ organizationId, category: "HOME" as const });

export const ADMIN_PAGE_SIZE = 50;

export interface ListingFilters {
  /** Matches the title or the address, case-insensitive. */
  q?: string;
  status?: ListingStatus;
  managementType?: ManagementType;
  license?: LicenseStatus;
  page?: number;
}

function licenseWhere(status: LicenseStatus, today: Date): Prisma.ListingWhereInput {
  const { expiredBefore, expiringUntil } = licenseBounds(today);
  const known = { licenseNumber: { not: null } };
  switch (status) {
    case "MISSING":
      return { OR: [{ licenseNumber: null }, { licenseExpiresAt: null }] };
    case "EXPIRED":
      return { ...known, licenseExpiresAt: { lt: expiredBefore } };
    case "EXPIRING":
      return { ...known, licenseExpiresAt: { gte: expiredBefore, lte: expiringUntil } };
    case "VALID":
      return { ...known, licenseExpiresAt: { gt: expiringUntil } };
  }
}

export interface ListingRow {
  id: string;
  title: string;
  propertyType: string | null;
  status: ListingStatus;
  managementType: ManagementType;
  commissionBps: number;
  address: string;
  placeName: string;
  ownerName: string;
  priceCents: number;
  coverUrl: string | null;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  license: LicenseState;
}

/** The organization's homes, filtered, most recently updated first. "Today" is the date in Marrakech. */
export async function listAdminListings(organizationId: string, filters: ListingFilters = {}, today = todayInTimeZone(MARRAKECH_TIMEZONE)) {
  const q = filters.q?.trim();
  const where: Prisma.ListingWhereInput = {
    ...homes(organizationId),
    ...(filters.status && { status: filters.status }),
    ...(filters.managementType && { managementType: filters.managementType }),
    ...(q && { OR: [{ title: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }] }),
    ...(filters.license && { AND: [licenseWhere(filters.license, today)] }),
  };
  const page = Math.max(1, filters.page ?? 1);
  const [total, rows] = await Promise.all([
    db.listing.count({ where }),
    db.listing.findMany({
      where,
      select: {
        id: true,
        title: true,
        propertyType: true,
        status: true,
        managementType: true,
        commissionBps: true,
        address: true,
        priceCents: true,
        licenseNumber: true,
        licenseExpiresAt: true,
        place: { select: { name: true } },
        owner: { select: { name: true } },
        photos: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
  ]);
  const items: ListingRow[] = rows.map(({ place, owner, photos, ...r }) => ({
    ...r,
    placeName: place.name,
    ownerName: owner.name,
    coverUrl: photos[0]?.url ?? null,
    license: licenseState(r, today),
  }));
  return { items, total, page, pageCount: Math.ceil(total / ADMIN_PAGE_SIZE) };
}

/** One home of the organization with everything the back-office shows and edits; null when not found. */
export async function getAdminListing(organizationId: string, id: string) {
  return db.listing.findFirst({
    where: { ...homes(organizationId), id },
    include: {
      place: { select: { id: true, name: true, slug: true } },
      owner: { select: { id: true, name: true, email: true, phone: true } },
      photos: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      amenities: { select: { amenity: { select: { id: true, label: true, group: true } } } },
    },
  });
}

export type AdminListing = NonNullable<Awaited<ReturnType<typeof getAdminListing>>>;

/** What the form offers: the organization's owners, the neighbourhoods, the amenities, the default commission. */
export async function listingFormOptions(organizationId: string) {
  const [owners, places, amenities, org] = await Promise.all([
    db.user.findMany({ where: { organizationId, role: "OWNER" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.place.findMany({ select: { id: true, name: true, lat: true, lng: true }, orderBy: { name: "asc" } }),
    db.amenity.findMany({ select: { id: true, label: true, group: true }, orderBy: [{ group: "asc" }, { label: "asc" }] }),
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { defaultCommissionBps: true } }),
  ]);
  return { owners, places, amenities, defaultCommissionBps: org.defaultCommissionBps };
}

export type ListingFormOptions = Awaited<ReturnType<typeof listingFormOptions>>;

const NEEDS_PHOTO = () => new AppError(422, "PHOTO_REQUIRED", "Ajoutez au moins une photo avant de publier le bien.");

/** Checks that need the database: owner of this organization, known neighbourhood and amenities. */
async function checkReferences(organizationId: string, input: ListingInput, tx: Prisma.TransactionClient) {
  await requireListingOwner(organizationId, input.ownerId, tx);
  if (!(await tx.place.count({ where: { id: input.placeId } }))) throw new AppError(422, "INVALID_PLACE", "Quartier inconnu.");
  if (input.amenityIds.length && (await tx.amenity.count({ where: { id: { in: input.amenityIds } } })) !== input.amenityIds.length) {
    throw new AppError(422, "INVALID_AMENITY", "Équipement inconnu.");
  }
}

function listingData(input: ListingInput) {
  const { amenityIds: _a, ...data } = input;
  void _a;
  // A sub-let takes no commission (listings_sublease_commission_check), whatever the form sent.
  return { ...data, commissionBps: data.managementType === "SUBLEASE" ? 0 : data.commissionBps };
}

/** Creates a home of the organization. It has no photo yet, so it can only start as a draft. */
export async function createAdminListing(organizationId: string, input: ListingInput): Promise<{ id: string }> {
  if (input.status === "PUBLISHED") throw NEEDS_PHOTO();
  return db.$transaction(async (tx) => {
    await checkReferences(organizationId, input, tx);
    const listing = await tx.listing.create({
      data: {
        ...listingData(input),
        category: "HOME",
        organizationId,
        amenities: { create: input.amenityIds.map((amenityId) => ({ amenityId })) },
      },
      select: { id: true },
    });
    return listing;
  });
}

/** Replaces every editable field of a home of the organization, amenities included. */
export async function updateAdminListing(organizationId: string, id: string, input: ListingInput): Promise<void> {
  await db.$transaction(async (tx) => {
    const current = await tx.listing.findFirst({ where: { ...homes(organizationId), id }, select: { id: true, _count: { select: { photos: true } } } });
    if (!current) throw notFound();
    if (input.status === "PUBLISHED" && current._count.photos === 0) throw NEEDS_PHOTO();
    await checkReferences(organizationId, input, tx);
    await tx.listingAmenity.deleteMany({ where: { listingId: id } });
    await tx.listing.update({
      where: { id },
      data: { ...listingData(input), amenities: { create: input.amenityIds.map((amenityId) => ({ amenityId })) } },
    });
  });
}

async function lockListing(tx: Prisma.TransactionClient, organizationId: string, listingId: string) {
  // Serialises photo changes of one listing (positions are rewritten as a whole).
  const rows = await tx.$queryRaw<{ id: string; status: ListingStatus; title: string }[]>`
    SELECT "id", "status", "title" FROM "listings"
    WHERE "id" = ${listingId} AND "organizationId" = ${organizationId} AND "category" = 'HOME'
    FOR UPDATE`;
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function renumber(tx: Prisma.TransactionClient, listingId: string, ids: string[]) {
  for (const [position, id] of ids.entries()) await tx.photo.update({ where: { id, listingId }, data: { position } });
}

const photoIds = async (tx: Prisma.TransactionClient, listingId: string) =>
  (await tx.photo.findMany({ where: { listingId }, select: { id: true }, orderBy: [{ position: "asc" }, { id: "asc" }] })).map((p) => p.id);

/**
 * Stores an uploaded photo (JPEG, PNG or WebP, checked by content, at most 5 MB) and appends it to the listing's
 * photos; the first photo becomes the cover. The file is written first and removed again if the row can't be.
 */
export async function addListingPhoto(organizationId: string, listingId: string, bytes: Uint8Array): Promise<{ id: string; url: string }> {
  const listing = await db.listing.findFirst({ where: { ...homes(organizationId), id: listingId }, select: { id: true } });
  if (!listing) throw notFound();
  const check = checkPhoto(bytes);
  if (!check.ok) throw new AppError(422, "INVALID_PHOTO", check.message);

  const storage = fileStorage();
  const key = `listings/${organizationId}/${listingId}/${randomBytes(16).toString("hex")}.${IMAGE_EXTENSION[check.type]}`;
  await storage.put(key, bytes, check.type);
  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockListing(tx, organizationId, listingId);
      const count = await tx.photo.count({ where: { listingId } });
      if (count >= MAX_PHOTOS_PER_LISTING) throw new AppError(422, "TOO_MANY_PHOTOS", `${MAX_PHOTOS_PER_LISTING} photos au maximum par bien.`);
      const photo = await tx.photo.create({
        data: { listingId, url: storage.url(key), storageKey: key, alt: locked.title, position: count },
        select: { id: true, url: true },
      });
      return photo;
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

/** Deletes a photo and its file. A published listing keeps at least one photo. */
export async function deleteListingPhoto(organizationId: string, listingId: string, photoId: string): Promise<void> {
  const removed = await db.$transaction(async (tx) => {
    const locked = await lockListing(tx, organizationId, listingId);
    const ids = await photoIds(tx, listingId);
    if (!ids.includes(photoId)) throw new AppError(404, "NOT_FOUND", "Photo introuvable.");
    if (locked.status === "PUBLISHED" && ids.length === 1) {
      throw new AppError(422, "LAST_PHOTO", "Un bien publié garde au moins une photo : repassez-le en brouillon pour la supprimer.");
    }
    const photo = await tx.photo.delete({ where: { id: photoId }, select: { storageKey: true } });
    await renumber(tx, listingId, ids.filter((id) => id !== photoId));
    return photo;
  });
  // After the commit: a failed file deletion leaves an orphan file, never a photo without its file.
  if (removed.storageKey) await fileStorage().delete(removed.storageKey).catch((e) => console.error("photo file not deleted", e));
}

export type PhotoMove = "cover" | "up" | "down";

/** Moves a photo one place earlier or later, or first (the cover). */
export async function moveListingPhoto(organizationId: string, listingId: string, photoId: string, move: PhotoMove): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockListing(tx, organizationId, listingId);
    const ids = await photoIds(tx, listingId);
    const from = ids.indexOf(photoId);
    if (from === -1) throw new AppError(404, "NOT_FOUND", "Photo introuvable.");
    const to = move === "cover" ? 0 : move === "up" ? Math.max(0, from - 1) : Math.min(ids.length - 1, from + 1);
    ids.splice(from, 1);
    ids.splice(to, 0, photoId);
    await renumber(tx, listingId, ids);
  });
}

/** Whether `photoKey` may be served to this visitor: photos of published listings are public, drafts are staff-only. */
export async function photoAccess(storageKey: string): Promise<{ organizationId: string; published: boolean } | null> {
  const photo = await db.photo.findUnique({
    where: { storageKey },
    select: { listing: { select: { organizationId: true, status: true } } },
  });
  return photo && { organizationId: photo.listing.organizationId, published: photo.listing.status === "PUBLISHED" };
}
