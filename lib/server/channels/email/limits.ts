import "server-only";
import { FailureLimiter, RateLimiter } from "../../rate-limit";

/**
 * Limits of the booking e-mail webhook (Lot 7b): 20 bad tokens per client address in 10 minutes, 120 messages per
 * organization in 10 minutes. Per process. Tests reset them.
 */
export const inboundLimits = {
  badTokens: new FailureLimiter(20, 10 * 60_000),
  perOrganization: new RateLimiter(120, 10 * 60_000),
  reset() {
    this.badTokens.reset();
    this.perOrganization.reset();
  },
};
