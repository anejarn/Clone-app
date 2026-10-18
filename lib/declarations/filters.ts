import { addDays, isoDay, parseDay } from "@/lib/admin/calendar";

/**
 * The filters of Déclarations and of its exports, from the URL: arrivals from `du` to `au` (both included,
 * yyyy-MM-dd; default the last 7 days up to today), `bien` (a home), `nondeclares=1` (only travellers not declared
 * yet), `q` (name or document number). The same parameters drive the page and the export links.
 */
export interface DeclarationQuery {
  from: Date;
  to: Date;
  listingId?: string;
  undeclaredOnly: boolean;
  q?: string;
}

export function parseDeclarationQuery(sp: Record<string, string | string[] | undefined>, today: Date): DeclarationQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const to = parseDay(one("au")) ?? today;
  const from = parseDay(one("du")) ?? addDays(to, -7);
  const bien = one("bien");
  const q = one("q")?.trim().slice(0, 80);
  return {
    from,
    to,
    ...(bien && /^[A-Za-z0-9_-]{1,64}$/.test(bien) && { listingId: bien }),
    undeclaredOnly: one("nondeclares") === "1",
    ...(q && { q }),
  };
}

export function declarationQueryString(q: DeclarationQuery, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ du: isoDay(q.from), au: isoDay(q.to), ...extra });
  if (q.listingId) p.set("bien", q.listingId);
  if (q.undeclaredOnly) p.set("nondeclares", "1");
  if (q.q) p.set("q", q.q);
  return p.toString();
}
