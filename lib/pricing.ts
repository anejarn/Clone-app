export const SERVICE_FEE_RATE = 0.14;

export function nightsBetween(checkin: Date, checkout: Date): number {
  return Math.max(0, Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000));
}

/** Total in cents for a stay: nightly × nights + cleaning + service fee on the subtotal. */
export function stayTotal(pricePerNight: number, nights: number, cleaningFee: number): number {
  if (nights <= 0) return 0;
  const subtotal = pricePerNight * nights + cleaningFee;
  return Math.round(subtotal * (1 + SERVICE_FEE_RATE));
}
