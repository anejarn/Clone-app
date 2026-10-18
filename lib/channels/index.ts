import type { PlatformSource } from "../admin/booking-sources";
import { IcalAdapter } from "./ical/adapter";
import type { ChannelAdapter } from "./types";

/**
 * Entry point of the channel layer (Lot 7). Every platform goes through iCal for now; when an official API is granted
 * (Airbnb, Booking.com: V3), return its adapter here for that source. Messaging (Lot 8) will need such an adapter: iCal
 * has no capabilities.messaging.
 */

let ical: ChannelAdapter = new IcalAdapter();

export function adapterFor(source: PlatformSource): ChannelAdapter {
  void source;
  return ical;
}

/** Tests replace the adapter (e.g. to count reads); undefined puts the real one back. */
export function setChannelAdapter(a: ChannelAdapter | undefined) {
  ical = a ?? new IcalAdapter();
}

export * from "./types";
export { PLATFORMS, platform, hostMatches, type PlatformDescriptor } from "./platforms";
