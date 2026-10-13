const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const euroFmt = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const ratingFmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** "8–10 janv." within a month, "30 oct. – 1 nov." across months. Dates are UTC midnights. */
export function formatDateRange(start: Date, end: Date): string {
  const sm = monthFmt.format(start);
  const em = monthFmt.format(end);
  if (sm === em && start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${sm}`;
  }
  return `${start.getUTCDate()} ${sm} – ${end.getUTCDate()} ${em}`;
}

export function formatEuros(cents: number): string {
  return euroFmt.format(Math.round(cents / 100));
}

const centsFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Exact amounts for price breakdowns: "360 €" for whole euros, "2,97 €" otherwise, so lines add up to the total. */
export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? formatEuros(cents) : centsFmt.format(cents / 100);
}

/** 5 → "5,0", 4.92 → "4,92" */
export function formatRating(rating: number): string {
  return ratingFmt.format(rating);
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** "1 logement", "9 logements", "Plus de 20 logements" */
export function countLabel(n: number): string {
  if (n === 1) return "1 logement";
  if (n < 20) return `${n} logements`;
  return `Plus de ${Math.floor(n / 10) * 10} logements`;
}
