/** The calendar date it is now in `timeZone`, as a UTC-midnight Date (the shape stored in @db.Date columns). */
export function todayInTimeZone(timeZone: string, now = Date.now()): Date {
  // en-CA formats as yyyy-MM-dd.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}
