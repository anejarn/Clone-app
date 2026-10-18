import { createHash } from "node:crypto";
import { isoDay } from "../../admin/calendar";
import { EXPORT_UID_DOMAIN } from "../busy";
import { fetchFeed, type FeedRequest, type FeedResponse, type FetchOptions } from "../fetch";
import { eventNights } from "../nights";
import type { PlatformDescriptor } from "../platforms";
import type { ChannelAdapter, ChannelEvent, ExportInput, ImportResult, SkippedEvent } from "../types";
import { allowPrivateFromEnv } from "../url";
import { buildCalendar, EXPORT_SUMMARY } from "./build";
import { parseIcal, type IcalCalendar } from "./parse";

/** The iCal adapter: reads a platform's .ics link, writes Sigma's. Availability only (no price, guest or amount). */

const MAX_REF = 200;

function refOf(p: PlatformDescriptor, ev: IcalCalendar["events"][number], nights: { checkIn: Date; checkOut: Date }): string {
  const ref = p.reference(ev) ?? ev.uid ?? `sans-uid-${createHash("sha256").update(`${isoDay(nights.checkIn)}:${isoDay(nights.checkOut)}:${ev.summary}`).digest("hex").slice(0, 24)}`;
  return ref.length > MAX_REF ? `uid-${createHash("sha256").update(ref).digest("hex")}` : ref;
}

/** The events of a parsed calendar, in nights at the home, classified for the platform. Pure. */
export function calendarEvents(p: PlatformDescriptor, cal: IcalCalendar): { events: ChannelEvent[]; skipped: SkippedEvent[] } {
  const events: ChannelEvent[] = [];
  const skipped: SkippedEvent[] = [];
  const seen = new Set<string>();
  for (const ev of cal.events) {
    const n = eventNights(ev);
    if (!n.ok) {
      skipped.push({ line: ev.line, reason: "INVALID_DATES" });
      continue;
    }
    const ref = refOf(p, ev, n.nights);
    if (seen.has(ref)) {
      skipped.push({ line: ev.line, reason: "DUPLICATE" });
      continue;
    }
    seen.add(ref);
    const cls = p.classify(ev);
    events.push({
      ref,
      uid: ev.uid,
      checkIn: n.nights.checkIn,
      checkOut: n.nights.checkOut,
      kind: cls.kind,
      ambiguous: cls.ambiguous,
      cancelled: ev.status === "CANCELLED",
      ownExport: (ev.uid?.endsWith(`@${EXPORT_UID_DOMAIN}`) ?? false) || ev.summary === EXPORT_SUMMARY,
    });
  }
  return { events, skipped };
}

export type Fetcher = (req: FeedRequest, opts?: FetchOptions) => Promise<FeedResponse>;

export class IcalAdapter implements ChannelAdapter {
  readonly id = "ical";
  readonly capabilities = {
    importAvailability: true,
    exportAvailability: true,
    pushRates: false,
    guestDetails: false,
    amounts: false,
    messaging: false,
    realtime: false,
  };

  constructor(private readonly fetcher: Fetcher = fetchFeed) {}

  async importEvents(p: PlatformDescriptor, request: FeedRequest): Promise<ImportResult> {
    const res = await this.fetcher(request, { allowPrivate: allowPrivateFromEnv() });
    if (res.notModified) return { notModified: true, httpStatus: 304 };
    const cal = parseIcal(res.body);
    const { events, skipped } = calendarEvents(p, cal);
    return { notModified: false, httpStatus: res.status, events, skipped, warnings: cal.warnings, etag: res.etag, lastModified: res.lastModified };
  }

  exportCalendar(input: ExportInput) {
    return { contentType: "text/calendar; charset=utf-8", body: buildCalendar(input.ranges, { now: input.now }) };
  }
}
