import type { PlatformSource } from "../admin/booking-sources";
import type { BusyRange } from "./busy";
import type { FeedRequest } from "./fetch";
import type { PlatformDescriptor } from "./platforms";

/**
 * The common interface of every way Sigma exchanges with a platform (Lot 7). Today there is one adapter, iCal
 * (lib/channels/ical/adapter.ts): availability only, both ways. An official API (Airbnb, Booking.com: later, after
 * their review) plugs in as another ChannelAdapter returned by adapterFor() (lib/channels/index.ts), with more
 * capabilities (prices, guest details, amounts, messages), without changing the callers: the sync
 * (lib/server/channels/sync.ts) only uses importEvents, and the export route only exportCalendar.
 */

export interface ChannelCapabilities {
  /** Reads the platform's reservations and blocked dates. */
  importAvailability: boolean;
  /** Gives the platform Sigma's busy dates. */
  exportAvailability: boolean;
  /** Sends prices and minimum stays (iCal can't: they are reported by hand). */
  pushRates: boolean;
  /** Guest name, contact, number of guests. */
  guestDetails: boolean;
  /** Amounts paid. */
  amounts: boolean;
  /** Messages with the guest (Lot 8 needs an official API). */
  messaging: boolean;
  /** Changes arrive at once (webhooks) instead of by polling. */
  realtime: boolean;
}

/** One reservation or block read from a platform, in nights at the home. */
export interface ChannelEvent {
  /** What identifies it across reads: the platform's reservation code when given, else the iCal UID. */
  ref: string;
  uid: string | null;
  checkIn: Date;
  checkOut: Date;
  kind: "reservation" | "block";
  /** May be Sigma's own export coming back (lib/channels/busy.ts isEcho). */
  ambiguous: boolean;
  /** The platform marks it cancelled (STATUS:CANCELLED): treated as absent. */
  cancelled: boolean;
  /** Carries Sigma's own UID or summary: certainly an echo of Sigma's export. */
  ownExport: boolean;
}

export interface SkippedEvent {
  line: number;
  reason: "INVALID_DATES" | "DUPLICATE";
}

export type ImportResult =
  | { notModified: true; httpStatus: 304 }
  | {
      notModified: false;
      httpStatus: number;
      events: ChannelEvent[];
      skipped: SkippedEvent[];
      warnings: string[];
      etag: string | null;
      lastModified: string | null;
    };

export interface ExportInput {
  ranges: readonly BusyRange[];
  now: Date;
}

export interface ExportResult {
  contentType: string;
  body: string;
}

export interface ChannelAdapter {
  readonly id: string;
  readonly capabilities: ChannelCapabilities;
  importEvents(platform: PlatformDescriptor, request: FeedRequest): Promise<ImportResult>;
  exportCalendar(input: ExportInput): ExportResult;
}

export type { PlatformSource };
