"use client";

import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ANYWHERE, emptyGuests, slugify, toSearchParams, type GuestCounts } from "@/lib/search/params";
import type { Place } from "@/lib/types";

/** Serializable starting values, passed from server pages. */
export interface SearchInitial {
  placeSlug?: string;
  where?: string;
  checkin?: string;
  checkout?: string;
  guests?: GuestCounts;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

/** Calendar dates are local midnights; the URL carries plain yyyy-MM-dd. */
const toParam = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : undefined);
/** Local calendar date → UTC midnight, the shape lib/format expects. */
export const asUTC = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

export function useSearchDraft(initial: SearchInitial = {}) {
  const router = useRouter();
  const [where, setWhereText] = useState(initial.where ?? "");
  const [placeSlug, setPlaceSlug] = useState(initial.placeSlug);
  const [range, setRange] = useState<DateRange | undefined>(
    initial.checkin && initial.checkout ? { from: parseISO(initial.checkin), to: parseISO(initial.checkout) } : undefined,
  );
  const [guests, setGuests] = useState<GuestCounts>(initial.guests ?? emptyGuests);

  return {
    where,
    placeSlug,
    range,
    guests,
    setWhere(text: string) {
      setWhereText(text);
      setPlaceSlug(undefined);
    },
    choosePlace(p: Place) {
      setWhereText(p.name);
      setPlaceSlug(p.slug);
    },
    setRange,
    setGuests,
    clear() {
      setWhereText("");
      setPlaceSlug(undefined);
      setRange(undefined);
      setGuests(emptyGuests);
    },
    /** `bestMatch`: first suggestion for the typed text, used when the user didn't pick one. */
    submit(bestMatch?: Place) {
      const slug = placeSlug ?? (where.trim() ? (bestMatch?.slug ?? slugify(where)) : ANYWHERE);
      const qs = toSearchParams({
        checkin: range?.to ? toParam(range.from) : undefined,
        checkout: toParam(range?.to),
        ...guests,
      }).toString();
      router.push(`/s/${slug}/homes${qs ? `?${qs}` : ""}`);
    },
  };
}

export type SearchDraft = ReturnType<typeof useSearchDraft>;
