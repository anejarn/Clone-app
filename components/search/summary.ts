import { formatDateRange } from "@/lib/format";
import { guestsSummary, type GuestCounts } from "@/lib/search/params";
import { asUTC, type DateRange } from "@/lib/search/useSearchDraft";

export function datesLabel(range?: DateRange): string | undefined {
  if (!range?.from) return undefined;
  if (!range.to) return formatDateRange(asUTC(range.from), asUTC(range.from)).replace(/^(\d+)–\d+/, "$1");
  return formatDateRange(asUTC(range.from), asUTC(range.to));
}

export function guestsLabel(g: GuestCounts): string | undefined {
  return guestsSummary(g) || undefined;
}
