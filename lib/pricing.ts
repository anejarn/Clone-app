export const SERVICE_FEE_RATE = 0.14;

export function nightsBetween(checkin: Date, checkout: Date): number {
  return Math.max(0, Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000));
}

export interface PriceBreakdown {
  nights: number;
  /** nightly × nights */
  stayCents: number;
  cleaningFeeCents: number;
  /** SERVICE_FEE_RATE of stay + cleaning, rounded to the cent */
  serviceFeeCents: number;
  /** Always the exact sum of the lines above. */
  totalCents: number;
}

export function priceBreakdown(pricePerNight: number, nights: number, cleaningFee: number): PriceBreakdown {
  if (nights <= 0) return { nights: 0, stayCents: 0, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 0 };
  const stayCents = pricePerNight * nights;
  const serviceFeeCents = Math.round((stayCents + cleaningFee) * SERVICE_FEE_RATE);
  return { nights, stayCents, cleaningFeeCents: cleaningFee, serviceFeeCents, totalCents: stayCents + cleaningFee + serviceFeeCents };
}

/** Total in cents for a stay: nightly × nights + cleaning + service fee. */
export function stayTotal(pricePerNight: number, nights: number, cleaningFee: number): number {
  return priceBreakdown(pricePerNight, nights, cleaningFee).totalCents;
}
