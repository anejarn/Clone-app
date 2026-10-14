import { formatDateRange, formatDay } from "@/lib/format";
import { guestsSummary, type GuestCounts } from "@/lib/search/params";
import { asUTC, hasNights, type DateRange } from "@/lib/search/useSearchDraft";

/**
 * "24–26 nov." for a range; "24 nov." for a check-in alone. react-day-picker reports the first click as a
 * range whose `to` is the same day as `from`, so a same-day end also counts as no end yet.
 */
export function datesLabel(range?: DateRange): string | undefined {
  if (!range?.from) return undefined;
  if (!hasNights(range)) return formatDay(asUTC(range.from));
  return formatDateRange(asUTC(range.from), asUTC(range.to));
}

export function guestsLabel(g: GuestCounts): string | undefined {
  return guestsSummary(g) || undefined;
}
