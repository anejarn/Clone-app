import { touristTax } from "./tourist-tax";

/**
 * Stay pricing. Guests pay no service fee: their total is nightly × nights + cleaning + taxe de séjour.
 * Owners pay Nidou a commission on nightly × nights + cleaning (the "base"), plus VAT on that commission.
 * All amounts are integer cents EUR.
 */

/** Standard commission: 10 % of the base (12 % with VAT). */
export const COMMISSION_BPS = 1000;
/** Founding hosts: 5 % for stays checking in on or before FOUNDING_OFFER_LAST_CHECKIN. */
export const FOUNDING_COMMISSION_BPS = 500;
export const FOUNDING_OFFER_LAST_CHECKIN = "2027-04-30";
/** VAT on the commission: 20 %. */
export const VAT_BPS = 2000;

export function nightsBetween(checkin: Date, checkout: Date): number {
  return Math.max(0, Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000));
}

/** Commission rate for a host and a check-in date (yyyy-MM-dd or a UTC-midnight Date). */
export function commissionBpsFor(isFoundingHost: boolean, checkIn: string | Date): number {
  const day = typeof checkIn === "string" ? checkIn : checkIn.toISOString().slice(0, 10);
  return isFoundingHost && day <= FOUNDING_OFFER_LAST_CHECKIN ? FOUNDING_COMMISSION_BPS : COMMISSION_BPS;
}

/** What the guest sees and pays. */
export interface GuestPrice {
  nights: number;
  nightlyCents: number;
  /** nightly × nights */
  stayCents: number;
  cleaningFeeCents: number;
  touristTaxCents: number;
  /** Always the exact sum of stay, cleaning and tourist tax. */
  totalCents: number;
}

/** What Nidou keeps and the owner receives. Never sent to guests. */
export interface HostSplit {
  commissionBps: number;
  commissionCents: number;
  commissionVatCents: number;
  /** base − commission − VAT */
  hostPayoutCents: number;
}

export function guestPrice(nightlyCents: number, nights: number, cleaningFeeCents: number, touristTaxCents: number): GuestPrice {
  if (nights <= 0) return { nights: 0, nightlyCents, stayCents: 0, cleaningFeeCents: 0, touristTaxCents: 0, totalCents: 0 };
  const stayCents = nightlyCents * nights;
  return { nights, nightlyCents, stayCents, cleaningFeeCents, touristTaxCents, totalCents: stayCents + cleaningFeeCents + touristTaxCents };
}

/** Splits the base (nightly × nights + cleaning) between Nidou and the owner. */
export function hostSplit(baseCents: number, commissionBps: number): HostSplit {
  const commissionCents = Math.round((baseCents * commissionBps) / 10_000);
  const commissionVatCents = Math.round((commissionCents * VAT_BPS) / 10_000);
  return { commissionBps, commissionCents, commissionVatCents, hostPayoutCents: baseCents - commissionCents - commissionVatCents };
}

export interface StayPricingInput {
  nightlyCents: number;
  cleaningFeeCents: number;
  nights: number;
  /** Check-in day, yyyy-MM-dd or UTC-midnight Date: decides the founding-host rate. */
  checkIn: string | Date;
  /** Commune INSEE code of the listing's place. */
  inseeCode: string;
  stars: number | null;
  isFoundingHost: boolean;
  adults: number;
  children?: number;
  infants?: number;
}

/** Both sides of a stay's price. Throws for a commune without a tourist-tax grid. */
export function priceStay(input: StayPricingInput): { guest: GuestPrice; host: HostSplit } {
  const nights = Math.max(0, input.nights);
  const tax = touristTax({ ...input, nights });
  const guest = guestPrice(input.nightlyCents, nights, input.cleaningFeeCents, tax.totalCents);
  const base = guest.stayCents + guest.cleaningFeeCents;
  return { guest, host: hostSplit(base, commissionBpsFor(input.isFoundingHost, input.checkIn)) };
}
