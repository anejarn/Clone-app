/**
 * CSV for spreadsheets used in Morocco and France (Excel in French): UTF-8 with a byte order mark (so accents and
 * Arabic names open correctly), « ; » as separator, CRLF line ends, every cell quoted when it holds a separator, a
 * quote or a line break (quotes doubled). A cell starting with = + - @ or a tab is prefixed with « ' » so that a
 * spreadsheet never runs it as a formula (CSV injection).
 */
export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";

export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

/** The whole file: BOM, header, rows, CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return CSV_BOM + [csvLine(header), ...rows.map(csvLine)].join("\r\n") + "\r\n";
}

/** yyyy-MM-dd → JJ/MM/AAAA; "" for null. */
export function frDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** 1 250 centimes → "12,50" (the amount, without the currency, for spreadsheets). */
export function csvAmount(centimes: number): string {
  const sign = centimes < 0 ? "-" : "";
  const a = Math.abs(centimes);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, "0")}`;
}
