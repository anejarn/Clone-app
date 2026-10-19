import { ACCOUNT_LABEL, KIND_LABEL, ownerEffect, type LedgerAccount, type LedgerKind } from "./ledger";
import { monthShort } from "./months";

/**
 * Accounting exports of the financial journal (Lot 6), two variants:
 *
 * - **fr** (« Export comptable », for Excel in French and the accountant's tools): UTF-8 with BOM, « ; » separator,
 *   CRLF, dates JJ/MM/AAAA (and the entry's time HH:mm, Marrakech), months MM/AAAA, amounts in dirhams with a decimal
 *   comma and no thousands separator (« -1234,50 »), French headers and labels.
 * - **machine** (scripts, imports): UTF-8 without BOM, « , » separator (RFC 4180, CRLF), ISO 8601 instants, yyyy-MM
 *   months, amounts in integer centimes, account and kind codes, ids.
 *
 * Text cells that start with = + - @ or a tab are prefixed with « ' » so that a spreadsheet never runs them as a formula
 * (CSV injection: descriptions and suppliers are typed by people); amounts are numbers generated here and never
 * prefixed, so a negative amount stays a number.
 */

export type ExportVariant = "fr" | "machine";

export interface LedgerExportRow {
  seq: number;
  createdAt: Date;
  period: string;
  originPeriod: string | null;
  kind: LedgerKind;
  account: LedgerAccount;
  amountCents: number;
  description: string;
  listingId: string | null;
  listingTitle: string | null;
  ownerId: string | null;
  ownerName: string | null;
  bookingId: string | null;
  bookingRef: string | null;
  expenseId: string | null;
  serviceRequestId: string | null;
  reversesId: string | null;
  actorId: string | null;
  actorName: string | null;
}

const BOM = "﻿";

function textCell(value: string | null | undefined, sep: string): string {
  let s = value ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** -123 450 centimes → "-1234,50". */
export function frAmount(centimes: number): string {
  if (!Number.isSafeInteger(centimes)) throw new RangeError(`not an amount of centimes: ${centimes}`);
  const sign = centimes < 0 ? "-" : "";
  const a = Math.abs(centimes);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, "0")}`;
}

const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** An instant as JJ/MM/AAAA HH:mm in Marrakech. */
export function frDateTime(instant: Date): string {
  const p = Object.fromEntries(parts.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export const FR_HEADER = [
  "N°",
  "Date d'écriture",
  "Mois comptable",
  "Mois d'origine (ajustement)",
  "Type",
  "Compte",
  "Libellé",
  "Bien",
  "Propriétaire",
  "Référence",
  "Montant (MAD)",
  "Effet sur le net propriétaire (MAD)",
  "Saisi par",
] as const;

export const MACHINE_HEADER = [
  "seq",
  "created_at",
  "period",
  "origin_period",
  "kind",
  "account",
  "amount_cents",
  "owner_effect_cents",
  "listing_id",
  "listing_title",
  "owner_id",
  "owner_name",
  "booking_id",
  "booking_ref",
  "expense_id",
  "service_request_id",
  "reverses_id",
  "actor_id",
  "actor_name",
  "description",
] as const;

function reference(r: LedgerExportRow): string {
  if (r.bookingId) return `Réservation ${r.bookingRef ?? r.bookingId}`;
  if (r.expenseId) return `Dépense ${r.expenseId}`;
  if (r.serviceRequestId) return `Demande ${r.serviceRequestId}`;
  return "";
}

export function ledgerCsv(rows: readonly LedgerExportRow[], variant: ExportVariant): string {
  if (variant === "fr") {
    const sep = ";";
    const lines = [FR_HEADER.map((h) => textCell(h, sep)).join(sep)];
    for (const r of rows) {
      lines.push(
        [
          String(r.seq),
          frDateTime(r.createdAt),
          monthShort(r.period),
          r.originPeriod ? monthShort(r.originPeriod) : "",
          textCell(KIND_LABEL[r.kind], sep),
          textCell(ACCOUNT_LABEL[r.account], sep),
          textCell(r.description, sep),
          textCell(r.listingTitle, sep),
          textCell(r.ownerName, sep),
          textCell(reference(r), sep),
          frAmount(r.amountCents),
          frAmount(ownerEffect(r.account, r.amountCents)),
          textCell(r.actorName ?? (r.actorId ? r.actorId : "Système"), sep),
        ].join(sep),
      );
    }
    return BOM + lines.join("\r\n") + "\r\n";
  }
  const sep = ",";
  const lines = [MACHINE_HEADER.join(sep)];
  for (const r of rows) {
    lines.push(
      [
        String(r.seq),
        r.createdAt.toISOString(),
        r.period,
        r.originPeriod ?? "",
        r.kind,
        r.account,
        String(r.amountCents),
        String(ownerEffect(r.account, r.amountCents)),
        textCell(r.listingId, sep),
        textCell(r.listingTitle, sep),
        textCell(r.ownerId, sep),
        textCell(r.ownerName, sep),
        textCell(r.bookingId, sep),
        textCell(r.bookingRef, sep),
        textCell(r.expenseId, sep),
        textCell(r.serviceRequestId, sep),
        textCell(r.reversesId, sep),
        textCell(r.actorId, sep),
        textCell(r.actorName, sep),
        textCell(r.description, sep),
      ].join(sep),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
