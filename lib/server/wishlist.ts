import "server-only";
import { PUBLISHED } from "./catalog";
import { db } from "./db";
import { AppError } from "./errors";

/**
 * Each account has one list per organization for now; the schema already allows several (P4). Lists and items
 * carry their organization (composite foreign keys keep an item's list and listing in it), and every read and
 * write is scoped to the given organization: a saved id from another organization is never returned or added.
 */
const DEFAULT_LIST = "Favoris";
export const MAX_SAVED = 500;

async function defaultListId(orgId: string, userId: string): Promise<string> {
  const list = await db.wishlist.upsert({
    where: { organizationId_userId_name: { organizationId: orgId, userId, name: DEFAULT_LIST } },
    create: { organizationId: orgId, userId, name: DEFAULT_LIST },
    update: {},
    select: { id: true },
  });
  return list.id;
}

/** Saved listing ids, most recent first. */
export async function wishlistIds(orgId: string, userId: string): Promise<string[]> {
  const items = await db.wishlistItem.findMany({
    where: { organizationId: orgId, wishlist: { organizationId: orgId, userId, name: DEFAULT_LIST } },
    select: { listingId: true },
    orderBy: { createdAt: "desc" },
  });
  return items.map((i) => i.listingId);
}

export async function saveListing(orgId: string, userId: string, listingId: string): Promise<void> {
  const exists = await db.listing.count({ where: { id: listingId, organizationId: orgId, ...PUBLISHED } });
  if (!exists) throw new AppError(404, "NOT_FOUND", "Logement introuvable.");
  const wishlistId = await defaultListId(orgId, userId);
  const count = await db.wishlistItem.count({ where: { wishlistId } });
  if (count >= MAX_SAVED) throw new AppError(422, "TOO_MANY", `Vous pouvez enregistrer ${MAX_SAVED} logements au maximum.`);
  await db.wishlistItem.upsert({
    where: { wishlistId_listingId: { wishlistId, listingId } },
    create: { wishlistId, listingId, organizationId: orgId },
    update: {},
  });
}

export async function unsaveListing(orgId: string, userId: string, listingId: string): Promise<void> {
  await db.wishlistItem.deleteMany({
    where: { organizationId: orgId, listingId, wishlist: { organizationId: orgId, userId, name: DEFAULT_LIST } },
  });
}

/** Folds favourites saved while signed out into the account; unknown ids are ignored. Returns the merged ids. */
export async function mergeWishlist(orgId: string, userId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)].slice(0, MAX_SAVED);
  if (unique.length) {
    const known = await db.listing.findMany({ where: { id: { in: unique }, organizationId: orgId, ...PUBLISHED }, select: { id: true } });
    const wishlistId = await defaultListId(orgId, userId);
    await db.wishlistItem.createMany({
      data: known.map((l) => ({ wishlistId, listingId: l.id, organizationId: orgId })),
      skipDuplicates: true,
    });
  }
  return wishlistIds(orgId, userId);
}
