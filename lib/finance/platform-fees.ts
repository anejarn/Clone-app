/**
 * Platform fees by default, per platform, as an organization parameter (Organization.platformFeeBps, a JSON object
 * { AIRBNB: 1550, … } in basis points). They are used ONLY when the real fee of a booking isn't known: the platform's
 * e-mail gave the payout and the guest total (fee = total − payout, exact), or an associé typed it — otherwise the
 * split estimates it as this percentage of the guest total, and the booking's split says « estimation ».
 *
 * The defaults below are PLACEHOLDERS to be replaced by the rates of Sigma's own contracts (they depend on the
 * platform's fee model, the country, the payment options): Airbnb host-only fee ~15,5 %, Booking.com commission
 * ~15 % + payment ~2 %, Agoda ~18 %, Trip.com ~15 %, Expedia / Vrbo ~15 %, other platforms 15 %.
 */

export type PlatformSource = "AIRBNB" | "BOOKING" | "AGODA" | "TRIPCOM" | "EXPEDIA" | "OTHER";
export const PLATFORM_SOURCES: readonly PlatformSource[] = ["AIRBNB", "BOOKING", "AGODA", "TRIPCOM", "EXPEDIA", "OTHER"];

export const DEFAULT_PLATFORM_FEE_BPS: Readonly<Record<PlatformSource, number>> = {
  AIRBNB: 1550,
  BOOKING: 1700,
  AGODA: 1800,
  TRIPCOM: 1500,
  EXPEDIA: 1500,
  OTHER: 1500,
};

/** 0 to 50 %. */
export const MAX_PLATFORM_FEE_BPS = 5_000;

export function isPlatformSource(s: string): s is PlatformSource {
  return (PLATFORM_SOURCES as readonly string[]).includes(s);
}

/** The organization's rates (stored JSON, possibly partial or invalid) completed with the defaults. */
export function platformFeeRates(stored: unknown): Record<PlatformSource, number> {
  const out = { ...DEFAULT_PLATFORM_FEE_BPS };
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (isPlatformSource(k) && Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_PLATFORM_FEE_BPS) out[k] = v as number;
    }
  }
  return out;
}

/** The default fee rate of a booking's source: 0 for DIRECT (and owner blocks). */
export function platformFeeBpsFor(source: string, stored: unknown): number {
  return isPlatformSource(source) ? platformFeeRates(stored)[source] : 0;
}
