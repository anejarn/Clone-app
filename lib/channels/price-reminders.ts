import { bpsToPercent } from "../money";

/**
 * Price reminders (Lot 7b): iCal carries no prices, so when a price changes in Sigma the team reports it by hand on
 * each platform. This module describes what changed, as the platforms' extranets show it: a season or event
 * (period, adjustment, minimum stay, priority) or a home's own price (base price, minimum stay, cleaning fee). Pure.
 *
 * A reminder keeps a full snapshot « before » (what the platform still has: the values when the first change was
 * made) and « after » (the values now). Further changes while the reminder is open replace « after » only
 * (mergeSnapshots); when « after » is back to « before », there is nothing left to report (isNoop).
 */

export interface ReminderLine {
  label: string;
  before: string | null;
  after: string | null;
}

export type Snapshot = Record<string, string | null>;

const pad = (n: number) => String(n).padStart(2, "0");
const ymdToFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** 120 000 → "1 200 MAD", 123 450 → "1 234,50 MAD" (exact: a platform price is typed to the centime). */
export function formatMad(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${cents < 0 ? "-" : ""}${grouped}${rest ? `,${pad(rest)}` : ""} MAD`;
}

export interface RuleShape {
  kind: "SEASON" | "EVENT";
  name: string;
  /** yyyy-MM-dd. */
  startDate: string;
  endDate: string;
  recurring: boolean;
  adjustment: { type: "PERCENT"; bps: number } | { type: "FIXED"; cents: number };
  minNights: number | null;
  priority: number;
}

export function rulePeriod(r: Pick<RuleShape, "startDate" | "endDate" | "recurring">): string {
  if (r.recurring) return `chaque année du ${ymdToFr(r.startDate).slice(0, 5)} au ${ymdToFr(r.endDate).slice(0, 5)} (nuits incluses)`;
  return `du ${ymdToFr(r.startDate)} au ${ymdToFr(r.endDate)} (nuits incluses)`;
}

export function ruleAdjustment(a: RuleShape["adjustment"]): string {
  if (a.type === "FIXED") return `${formatMad(a.cents)} la nuit`;
  if (a.bps === 0) return "prix de base inchangé";
  return `${a.bps > 0 ? "+" : "−"}${bpsToPercent(Math.abs(a.bps))} % sur le prix de base`;
}

/** What a platform needs to know of a rule (null: the rule doesn't exist on that side). */
export function ruleSnapshot(r: RuleShape | null): Snapshot {
  return {
    Nom: r ? r.name : null,
    Type: r ? (r.kind === "EVENT" ? "Événement" : "Saison") : null,
    Période: r ? rulePeriod(r) : null,
    Prix: r ? ruleAdjustment(r.adjustment) : null,
    "Séjour minimum": r ? (r.minNights ? `${r.minNights} nuit${r.minNights > 1 ? "s" : ""}` : "celui du bien") : null,
  };
}

export interface ListingPriceShape {
  priceCents: number;
  minNights: number;
  cleaningFeeCents: number;
}

export function listingSnapshot(l: ListingPriceShape): Snapshot {
  return {
    "Prix de base par nuit": formatMad(l.priceCents),
    "Séjour minimum": `${l.minNights} nuit${l.minNights > 1 ? "s" : ""}`,
    "Frais de ménage": l.cleaningFeeCents ? formatMad(l.cleaningFeeCents) : "aucun",
  };
}

/** Whether a listing's change concerns the platforms (base price, minimum stay or cleaning fee). */
export function listingPriceChanged(a: ListingPriceShape, b: ListingPriceShape): boolean {
  return a.priceCents !== b.priceCents || a.minNights !== b.minNights || a.cleaningFeeCents !== b.cleaningFeeCents;
}

/** Every line of two snapshots, in the order of their labels. */
export function linesOf(before: Snapshot, after: Snapshot): ReminderLine[] {
  const labels = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return labels.map((label) => ({ label, before: before[label] ?? null, after: after[label] ?? null }));
}

/** The lines that differ (what the page shows). */
export function changedLines(lines: readonly ReminderLine[]): ReminderLine[] {
  return lines.filter((l) => l.before !== l.after);
}

/** An open reminder changed again: keep what the platform still has (« before »), take the new « after ». */
export function mergeSnapshots(open: readonly ReminderLine[], next: readonly ReminderLine[]): ReminderLine[] {
  const before = Object.fromEntries(open.map((l) => [l.label, l.before]));
  const after = Object.fromEntries(next.map((l) => [l.label, l.after]));
  for (const l of next) if (!(l.label in before)) before[l.label] = l.before;
  return linesOf(before, after);
}

export function isNoop(lines: readonly ReminderLine[]): boolean {
  return changedLines(lines).length === 0;
}

/** Reads a stored changes column; anything else reads as no line. */
export function parseLines(json: unknown): ReminderLine[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x) =>
    x && typeof x === "object" && typeof (x as ReminderLine).label === "string"
      ? [{ label: (x as ReminderLine).label, before: (x as ReminderLine).before ?? null, after: (x as ReminderLine).after ?? null }]
      : [],
  );
}
