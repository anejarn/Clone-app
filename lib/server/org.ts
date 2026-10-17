import "server-only";
import { db } from "./db";

/**
 * Organization scoping. Every catalogue and activity query takes an organization id; nothing reads across
 * organizations. The public site (search, listing pages, booking, trips, favourites) is the catalogue of one
 * organization, named by SIGMA_ORG_SLUG (default "sigma").
 */

export const DEFAULT_PUBLIC_ORG_SLUG = "sigma";

export function publicOrgSlug(): string {
  return process.env.SIGMA_ORG_SLUG?.trim() || DEFAULT_PUBLIC_ORG_SLUG;
}

/** Ids by slug, once per process: organizations are never renamed or deleted at runtime. */
const idsBySlug = new Map<string, Promise<string>>();

export async function orgIdBySlug(slug: string): Promise<string> {
  let id = idsBySlug.get(slug);
  if (!id) {
    id = db.organization.findUnique({ where: { slug }, select: { id: true } }).then((o) => {
      if (!o) throw new Error(`Organization "${slug}" not found: run the migrations and the seed (pnpm db:seed).`);
      return o.id;
    });
    // A failed lookup isn't remembered, so the next request retries.
    id.catch(() => idsBySlug.delete(slug));
    idsBySlug.set(slug, id);
  }
  return id;
}

/** The organization whose catalogue the public site shows. */
export function publicOrgId(): Promise<string> {
  return orgIdBySlug(publicOrgSlug());
}
