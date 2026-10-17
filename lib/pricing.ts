/**
 * Fee a guest pays on top of the stay and cleaning, as a fraction of both. Sigma rents out the homes it manages
 * itself: it is not a marketplace between hosts and guests, so there is no guest service fee.
 */
export const SERVICE_FEE_RATE = 0;

export function nightsBetween(checkin: Date, checkout: Date): number {
  return Math.max(0, Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000));
}

/** Amounts are integer centimes of dirham (MAD). */
export interface PriceBreakdown {
  nights: number;
  /** nightly × nights */
  stayCents: number;
  cleaningFeeCents: number;
  /** `rate` of stay + cleaning, rounded to the centime; 0 at Sigma's rate. */
  serviceFeeCents: number;
  /** Always the exact sum of the lines above. */
  totalCents: number;
}

export function priceBreakdown(pricePerNight: number, nights: number, cleaningFee: number, rate = SERVICE_FEE_RATE): PriceBreakdown {
  if (nights <= 0) return { nights: 0, stayCents: 0, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 0 };
  const stayCents = pricePerNight * nights;
  const serviceFeeCents = Math.round((stayCents + cleaningFee) * rate);
  return { nights, stayCents, cleaningFeeCents: cleaningFee, serviceFeeCents, totalCents: stayCents + cleaningFee + serviceFeeCents };
}

/** Total in centimes for a stay: nightly × nights + cleaning (+ the service fee, none at Sigma). */
export function stayTotal(pricePerNight: number, nights: number, cleaningFee: number): number {
  return priceBreakdown(pricePerNight, nights, cleaningFee).totalCents;
}
