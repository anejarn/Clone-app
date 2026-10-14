import { z } from "zod";

/** yyyy-MM-dd that is also a real calendar date (rejects 2026-02-31). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Date invalide");
/** Cap on adults + children in a search (the guest picker's steppers stop there). */
export const MAX_GUESTS = 16;

const count = (min: number, max: number) => z.coerce.number().int().min(min).max(max).catch(min);

export const searchQuerySchema = z.object({
  checkin: isoDate.optional().catch(undefined),
  checkout: isoDate.optional().catch(undefined),
  adults: count(0, 16),
  children: count(0, 15),
  infants: count(0, 5),
  pets: count(0, 5),
  pinned: z.string().max(64).optional().catch(undefined),
  // Out-of-range pages are just empty; junk falls back to page 1.
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type GuestCounts = Pick<SearchQuery, "adults" | "children" | "infants" | "pets">;

/** URL segment for a search without a destination. */
export const ANYWHERE = "partout";

export const emptyGuests: GuestCounts = { adults: 0, children: 0, infants: 0, pets: 0 };

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseSearchQuery(raw: RawParams): SearchQuery {
  const obj: Record<string, string> = {};
  const entries = raw instanceof URLSearchParams ? raw.entries() : Object.entries(raw);
  for (const [k, v] of entries) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== "") obj[k] = value;
  }
  const q = searchQuerySchema.parse(obj);
  // A range is only meaningful when checkout is after checkin.
  if (!q.checkin || !q.checkout || q.checkout <= q.checkin) {
    q.checkin = undefined;
    q.checkout = undefined;
  }
  // Children, infants or pets imply at least one adult.
  if (q.adults === 0 && q.children + q.infants + q.pets > 0) q.adults = 1;
  return q;
}

export function toSearchParams(q: Partial<SearchQuery>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.checkin && q.checkout) {
    p.set("checkin", q.checkin);
    p.set("checkout", q.checkout);
  }
  for (const k of ["adults", "children", "infants", "pets"] as const) {
    if (q[k]) p.set(k, String(q[k]));
  }
  if (q.pinned) p.set("pinned", q.pinned);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  return p;
}

export function totalGuests(g: GuestCounts): number {
  return g.adults + g.children;
}

/** "2 voyageurs, 1 bébé" style summary; empty string when nobody is selected. */
export function guestsSummary(g: GuestCounts): string {
  const parts: string[] = [];
  const guests = totalGuests(g);
  if (guests) parts.push(`${guests} voyageur${guests > 1 ? "s" : ""}`);
  if (g.infants) parts.push(`${g.infants} bébé${g.infants > 1 ? "s" : ""}`);
  if (g.pets) parts.push(`${g.pets} ${g.pets > 1 ? "animaux" : "animal"}`);
  return parts.join(", ");
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fromISODate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
