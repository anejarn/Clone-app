const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
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

/** "24 nov.": one day, same style as formatDateRange. Dates are UTC midnights. */
export function formatDay(day: Date): string {
  return `${day.getUTCDate()} ${monthFmt.format(day)}`;
}

/** Narrow no-break space between thousands, no-break space before the currency (French typography). */
const THOUSANDS = "\u202f";
const BEFORE_UNIT = "\u00a0";

/**
 * An amount in centimes of dirham as whole dirhams: 139_200 → "1 392 MAD". Halves round away from zero
 * (34_750 → "348 MAD"), so a price and its negative read the same.
 */
export function formatPrice(centimes: number): string {
  const dirhams = Math.round(Math.abs(centimes) / 100);
  const grouped = String(dirhams).replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS);
  return `${centimes < 0 && dirhams > 0 ? "-" : ""}${grouped}${BEFORE_UNIT}MAD`;
}

/** "24/11/2026": a date on its own, JJ/MM/AAAA. Dates are UTC midnights (@db.Date columns). */
export function formatDate(day: Date): string {
  const dd = String(day.getUTCDate()).padStart(2, "0");
  const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${day.getUTCFullYear()}`;
}

/** "Du 24/11/2026 au 26/11/2026": a stay with full dates (trips). */
export function formatStayDates(checkIn: Date, checkOut: Date): string {
  return `Du ${formatDate(checkIn)} au ${formatDate(checkOut)}`;
}

/** 5 → "5,0", 4.92 → "4,92" */
export function formatRating(rating: number): string {
  return ratingFmt.format(rating);
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** "1 logement", "20 logements", then "Plus de 110 logements" for 111 to 120: always strictly fewer than n. */
export function countLabel(n: number): string {
  if (n === 1) return "1 logement";
  if (n <= 20) return `${n} logements`;
  return `Plus de ${Math.floor((n - 1) / 10) * 10} logements`;
}
