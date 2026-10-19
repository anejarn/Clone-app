import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Calendar synchronisation by iCal (Lot 7) through the real actions, routes, sync and worker functions, against feeds
 * served by a local HTTP server (CHANNELS_ALLOW_PRIVATE_URLS=1 in the integration env): import creates, re-dates and
 * cancels bookings (with their field tasks), idempotent re-runs, conflicts both ways and their resolution, a feed that
 * fails (500, timeout, invalid file) → journal error and stale alert, ETag 304, the export link's content, revocation
 * and regeneration, who may do what (anonymous, guest, owner, agent, admin without 2FA, another organization: refused
 * or « introuvable »), preparation days and minimum notice on the site's bookings, advisory locks and daily jobs.
 * Seeded homes, nights from day 420 on; every row this file makes is deleted at the end.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/biens/channel-actions");
const syncAct = await import("@/app/admin/synchronisation/actions");
const { GET: icalGet, HEAD: icalHead } = await import("@/app/ical/[file]/route");
const { db } = await import("@/lib/server/db");
const { listingChannels, feedHealth } = await import("@/lib/server/channels/feeds");
const { syncFeed } = await import("@/lib/server/channels/sync");
const { listConflicts, syncAlerts, resolveConflict } = await import("@/lib/server/channels/conflicts");
const { alertStaleFeeds } = await import("@/lib/server/channels/alerts");
const { PgLocker, closeLockPool } = await import("@/lib/server/jobs/locks");
const { DAILY_JOBS, runDailyJob, syncDueFeeds } = await import("@/lib/server/jobs/worker");
const { setChannelAdapter } = await import("@/lib/channels");
const { IcalAdapter } = await import("@/lib/channels/ical/adapter");
const { fetchFeed } = await import("@/lib/channels/fetch");
const { setNotifier } = await import("@/lib/notifications");
const { quoteStay } = await import("@/lib/server/bookings");
const { ENVELOPE_RE } = await import("@/lib/secrets/envelope");
const { addDays, isoDay } = await import("@/lib/admin/calendar");
const { day, sigmaOrgId, utcToday } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const sigma = await sigmaOrgId();
const ORIGIN = "http://localhost:3100";

// ---------- Local feed server ----------

interface Route {
  status?: number;
  body?: string;
  etag?: string;
  delayMs?: number;
}
const routes = new Map<string, Route>();
const seen: { path: string; ifNoneMatch?: string }[] = [];
let server: http.Server;
let base: string;

const ymd = (iso: string) => iso.replaceAll("-", "");
function ics(events: { uid: string; from: number; to: number; summary?: string; description?: string; status?: string }[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Feed//EN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTART;VALUE=DATE:${ymd(day(e.from))}`, `DTEND;VALUE=DATE:${ymd(day(e.to))}`, `SUMMARY:${e.summary ?? "Reserved"}`);
    if (e.description) lines.push(`DESCRIPTION:${e.description}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
const serve = (path: string, r: Route) => {
  routes.set(path, r);
  return `${base}${path}`;
};

// ---------- People ----------

interface Member {
  headers: Headers;
  actor: Authorized;
}
let admin: Member;
let otherAdmin: Member;
const refusers: Record<string, Headers> = {};
let otherOrg: string;
const as = (m: { headers: Headers }) => {
  ctx.headers = m.headers;
};

let homes: { id: string; title: string }[];
const notified: { kind: string; text: string }[] = [];

async function member(role: "ADMIN" | "AGENT" | "OWNER" | "GUEST", organizationId: string | null, twoFactor = true): Promise<Member> {
  const { user, headers } = await signedInMember({ role, organizationId, twoFactor });
  return { headers, actor: { user: { id: user.id, name: user.name, email: user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" } };
}

async function feedOf(listingId: string, source: "AIRBNB" | "BOOKING" | "AGODA") {
  return db.channelFeed.findUniqueOrThrow({ where: { listingId_source: { listingId, source } } });
}

async function setImport(listingId: string, source: string, url: string) {
  as(admin);
  const form = new FormData();
  form.set("url", url);
  return act.setImportUrlAction(listingId, source, {}, form);
}

const today = utcToday();
const t0 = new Date();
const ownBookings = (feedId: string) => db.booking.findMany({ where: { channelFeedId: feedId }, orderBy: { checkIn: "asc" }, include: { tasks: { select: { type: true, status: true, scheduledDate: true } } } });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    seen.push({ path, ifNoneMatch: req.headers["if-none-match"] as string | undefined });
    const r = routes.get(path);
    const send = () => {
      if (!r) {
        res.writeHead(404).end("nope");
        return;
      }
      if (r.etag && req.headers["if-none-match"] === r.etag) {
        res.writeHead(304, { ETag: r.etag }).end();
        return;
      }
      res.writeHead(r.status ?? 200, { "Content-Type": "text/calendar; charset=utf-8", ...(r.etag && { ETag: r.etag }) }).end(r.body ?? "");
    };
    if (r?.delayMs) setTimeout(send, r.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `channels-${Date.now()}` } })).id;
  admin = await member("ADMIN", sigma);
  otherAdmin = await member("ADMIN", otherOrg);
  refusers.anonymous = new Headers();
  refusers.guest = (await member("GUEST", null, false)).headers;
  refusers.owner = (await member("OWNER", sigma, false)).headers;
  refusers.agent = (await member("AGENT", sigma)).headers;
  refusers["admin without 2FA"] = (await member("ADMIN", sigma, false)).headers;
  homes = await db.listing.findMany({ where: { organizationId: sigma, category: "HOME" }, select: { id: true, title: true }, orderBy: { id: "desc" }, take: 8 });
  setNotifier({
    name: "test",
    send: async (n) => {
      notified.push({ kind: n.kind, text: n.text });
      return { delivered: true, channel: "email" };
    },
  });
});

beforeEach(() => {
  notified.length = 0;
});

afterAll(async () => {
  setNotifier(undefined);
  setChannelAdapter(undefined);
  const feeds = await db.channelFeed.findMany({ where: { organizationId: { in: [sigma, otherOrg] } }, select: { id: true } });
  const ids = feeds.map((f) => f.id);
  await db.booking.deleteMany({ where: { OR: [{ channelFeedId: { in: ids } }, { note: "channels-test" }] } });
  await db.channelFeed.deleteMany({ where: { id: { in: ids } } });
  await db.listing.updateMany({ where: { id: { in: homes.map((h) => h.id) } }, data: { preparationDays: 0, minNoticeDays: 0 } });
  await db.auditLog.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { organizationId: otherOrg } });
  await db.organization.delete({ where: { id: otherOrg } });
  await closeLockPool();
  await new Promise((r) => server.close(r));
});

// ---------- Access ----------

describe("who may connect a home to the platforms", () => {
  it("anonymous, guests, owners, agents and admins without 2FA are refused every action", async () => {
    const home = homes[0].id;
    for (const [who, headers] of Object.entries(refusers)) {
      ctx.headers = headers;
      const form = new FormData();
      form.set("url", `${base}/x.ics`);
      for (const r of [
        await act.issueExportLinkAction(home, "AIRBNB"),
        await act.setImportUrlAction(home, "AIRBNB", {}, form),
        await act.syncNowAction(home, "AIRBNB"),
        await act.revokeExportLinkAction(home, "AIRBNB"),
        await act.saveBookingRulesAction(home, {}, form),
        await syncAct.resolveConflictAction("c0000000000000000000000000", "DISMISS"),
      ]) {
        expect(r.error, who).toMatch(/Connectez-vous|Accès refusé|double authentification/);
      }
    }
    expect(await db.channelFeed.count({ where: { listingId: home } })).toBe(0);
  });

  it("another organization's admin finds nothing of Sigma's", async () => {
    as(otherAdmin);
    expect((await act.issueExportLinkAction(homes[0].id, "AIRBNB")).error).toBe("Bien introuvable.");
    const form = new FormData();
    form.set("url", `${base}/x.ics`);
    expect((await act.setImportUrlAction(homes[0].id, "AIRBNB", {}, form)).error).toBe("Bien introuvable.");
    expect(await listingChannels(otherOrg, homes[0].id, ORIGIN)).toBeNull();
    expect(await db.channelFeed.count({ where: { listingId: homes[0].id } })).toBe(0);
  });

  it("an unknown platform or a bad link is refused", async () => {
    as(admin);
    expect((await act.issueExportLinkAction(homes[0].id, "DIRECT")).error).toBe("Plateforme inconnue.");
    expect((await setImport(homes[0].id, "AIRBNB", "ftp://example.com/x.ics")).error).toMatch(/https/);
  });
});

// ---------- Import ----------

describe("import", () => {
  it("creates platform bookings with their tasks, no amounts, encrypted URL; journal and audit; a re-run changes nothing", async () => {
    const home = homes[0].id;
    const url = serve("/a1.ics", {
      body: ics([
        { uid: "u1@airbnb.com", from: 420, to: 423, description: "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMINT00001\\nPhone Number (Last 4 Digits): 1234" },
        { uid: "u2@airbnb.com", from: 430, to: 432, summary: "Airbnb (Not available)" },
        { uid: "u3@airbnb.com", from: 10, to: 5 },
      ]),
    });
    const saved = await setImport(home, "AIRBNB", url);
    expect(saved.error).toBeUndefined();
    expect(saved.warning).toMatch(/ne semble pas venir d'Airbnb/);
    const feed = await feedOf(home, "AIRBNB");
    expect(feed.importUrlEnc).toMatch(ENVELOPE_RE);
    expect(feed.importUrlEnc).not.toContain("127.0.0.1");
    expect(feed.importHost).toBe("127.0.0.1");

    const r = await act.syncNowAction(home, "AIRBNB");
    expect(r.message).toMatch(/2 événement\(s\), 2 créée\(s\)/);
    const bookings = await ownBookings(feed.id);
    expect(bookings.map((b) => [b.source, b.externalRef, isoDay(b.checkIn), isoDay(b.checkOut), b.channelBlock, b.totalCents, b.guestName, b.status])).toEqual([
      ["AIRBNB", "HMINT00001", day(420), day(423), false, null, null, "CONFIRMED"],
      ["AIRBNB", "u2@airbnb.com", day(430), day(432), true, null, null, "CONFIRMED"],
    ]);
    expect(bookings[0].tasks.map((t) => t.type).sort()).toEqual(["CHECKIN", "CLEANING", "LINEN"]);
    expect(bookings[1].tasks).toEqual([]);
    // Lot 6: the imported stay has a split waiting for its amount (iCal carries none); the « not available » block has none.
    expect(await db.bookingFinance.findUnique({ where: { bookingId: bookings[0].id } })).toMatchObject({ status: "MISSING_AMOUNT", grossCents: 0 });
    expect(await db.bookingFinance.findUnique({ where: { bookingId: bookings[1].id } })).toBeNull();
    expect(await db.financialEntry.count({ where: { bookingId: { in: bookings.map((b) => b.id) } } })).toBe(0);

    const run = await db.channelSyncRun.findFirstOrThrow({ where: { feedId: feed.id }, orderBy: { startedAt: "desc" } });
    expect(run).toMatchObject({ trigger: "MANUAL", outcome: "SUCCESS", httpStatus: 200, eventsSeen: 2, created: 2, updated: 0, cancelled: 0, conflicts: 0, ignored: 1, errorCode: null });
    const audit = await db.auditLog.findMany({ where: { organizationId: sigma, targetId: { in: bookings.map((b) => b.id) } } });
    expect(audit.map((a) => a.action)).toEqual(["channel.booking_imported", "channel.booking_imported"]);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { targetId: home, action: "channel.import_url_set" } }))).not.toContain("a1.ics");

    const again = await syncFeed(feed.id, { trigger: "SCHEDULED" });
    expect(again).toMatchObject({ outcome: "SUCCESS", created: 0, updated: 0, cancelled: 0, conflicts: 0 });
    expect((await ownBookings(feed.id)).map((b) => b.id)).toEqual(bookings.map((b) => b.id));
  });

  it("re-dates when the event moves, tasks follow; cancels when it disappears (never a started stay)", async () => {
    const home = homes[0].id;
    const feed = await feedOf(home, "AIRBNB");
    serve("/a1.ics", { body: ics([{ uid: "u1@airbnb.com", from: 421, to: 425, description: "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMINT00001" }]) });
    const r = await syncFeed(feed.id, { trigger: "SCHEDULED" });
    expect(r).toMatchObject({ outcome: "SUCCESS", updated: 1, cancelled: 1 });
    const [moved, gone] = await ownBookings(feed.id);
    expect([isoDay(moved.checkIn), isoDay(moved.checkOut), moved.status]).toEqual([day(421), day(425), "CONFIRMED"]);
    expect(moved.tasks.find((t) => t.type === "CLEANING")!.scheduledDate.toISOString().slice(0, 10)).toBe(day(425));
    expect(gone.status).toBe("CANCELLED");
    expect(await db.bookingFinance.findUnique({ where: { bookingId: moved.id } })).toMatchObject({ status: "MISSING_AMOUNT", nights: 4 });
    // The event coming back reactivates the same row (never a duplicate).
    serve("/a1.ics", { body: ics([{ uid: "u1@airbnb.com", from: 421, to: 425, description: "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMINT00001" }, { uid: "u2@airbnb.com", from: 430, to: 432, summary: "Airbnb (Not available)" }]) });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 1, cancelled: 0 });
    expect((await ownBookings(feed.id)).map((b) => b.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
  });

  it("STATUS:CANCELLED cancels; an empty file that would cancel several bookings is refused", async () => {
    const home = homes[0].id;
    const feed = await feedOf(home, "AIRBNB");
    serve("/a1.ics", { body: ics([]) });
    const r = await syncFeed(feed.id, { trigger: "SCHEDULED" });
    expect(r).toMatchObject({ outcome: "ERROR", errorCode: "EMPTY_FEED", cancelled: 0 });
    expect((await ownBookings(feed.id)).every((b) => b.status === "CONFIRMED")).toBe(true);
    serve("/a1.ics", { body: ics([{ uid: "u1@airbnb.com", from: 421, to: 425, description: "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMINT00001" }, { uid: "u2@airbnb.com", from: 430, to: 432, status: "CANCELLED" }]) });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "SUCCESS", cancelled: 1 });
  });

  it("adopts a booking typed by hand with the same Airbnb code instead of duplicating it", async () => {
    const home = homes[1].id;
    const typed = await db.booking.create({ data: { organizationId: sigma, listingId: home, source: "AIRBNB", externalRef: "HMINT00009", checkIn: new Date(`${day(440)}T00:00:00Z`), checkOut: new Date(`${day(443)}T00:00:00Z`), adults: 2, guestName: "Typed", note: "channels-test" } });
    const url = serve("/adopt.ics", { body: ics([{ uid: "z@airbnb.com", from: 440, to: 444, description: "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMINT00009" }]) });
    await setImport(home, "AIRBNB", url);
    const feed = await feedOf(home, "AIRBNB");
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "SUCCESS", created: 0, updated: 1, conflicts: 0 });
    const b = await db.booking.findUniqueOrThrow({ where: { id: typed.id } });
    expect([b.channelFeedId, isoDay(b.checkOut), b.guestName]).toEqual([feed.id, day(444), "Typed"]);
    expect(await db.booking.count({ where: { organizationId: sigma, source: "AIRBNB", externalRef: "HMINT00009" } })).toBe(1);
  });
});

// ---------- Conflicts ----------

describe("double bookings", () => {
  it("an import over an owner block: conflict recorded, no booking, notified, banner; resolved by replacing", async () => {
    const home = homes[2].id;
    const block = await db.booking.create({ data: { organizationId: sigma, listingId: home, source: "OWNER", adults: 0, checkIn: new Date(`${day(450)}T00:00:00Z`), checkOut: new Date(`${day(455)}T00:00:00Z`), note: "channels-test" } });
    const url = serve("/c1.ics", { body: ics([{ uid: "c1@booking.com", from: 452, to: 454, summary: "CLOSED - Not available" }]) });
    await setImport(home, "BOOKING", url);
    const feed = await feedOf(home, "BOOKING");
    const r = await syncFeed(feed.id, { trigger: "SCHEDULED" });
    expect(r).toMatchObject({ outcome: "SUCCESS", created: 0, conflicts: 1 });
    expect(await ownBookings(feed.id)).toEqual([]);
    const [c] = await listConflicts(sigma, { listingId: home, status: "OPEN" });
    expect(c).toMatchObject({ source: "BOOKING", externalRef: "c1@booking.com", checkIn: day(452), checkOut: day(454), blockingBookingId: block.id, blockingSource: "OWNER" });
    expect(notified.map((n) => n.kind)).toContain("channel_conflict");
    expect(notified.find((n) => n.kind === "channel_conflict")!.text).toMatch(/Booking\.com du \d{2}\/\d{2}\/\d{4}/);
    expect((await syncAlerts(sigma)).openConflicts).toBeGreaterThanOrEqual(1);

    // Read again: the same conflict, not a second one, not notified again.
    notified.length = 0;
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ conflicts: 0 });
    expect(await db.channelConflict.count({ where: { feedId: feed.id } })).toBe(1);
    expect(notified).toEqual([]);

    // Another organization can't resolve it.
    await expect(resolveConflict(otherAdmin.actor, c.id, "REPLACE")).rejects.toMatchObject({ status: 404 });
    as(admin);
    const res = await syncAct.resolveConflictAction(c.id, "REPLACE");
    expect(res.message).toMatch(/annulée/);
    expect((await db.booking.findUniqueOrThrow({ where: { id: block.id } })).status).toBe("CANCELLED");
    const [imported] = await ownBookings(feed.id);
    expect([imported.source, imported.externalRef, isoDay(imported.checkIn), imported.status]).toEqual(["BOOKING", "c1@booking.com", day(452), "CONFIRMED"]);
    expect((await db.channelConflict.findUniqueOrThrow({ where: { id: c.id } })).resolution).toBe("REPLACED");
    // The next read finds it in place.
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 0, updated: 0, conflicts: 0 });
  });

  it("two platforms on the same nights: the second import conflicts; dismissed stays dismissed; freed nights go through", async () => {
    const home = homes[3].id;
    const a = serve("/p-air.ics", { body: ics([{ uid: "p1@airbnb.com", from: 460, to: 463 }]) });
    const b = serve("/p-bk.ics", { body: ics([{ uid: "p2@booking.com", from: 462, to: 465, summary: "CLOSED - Not available" }]) });
    await setImport(home, "AIRBNB", a);
    await setImport(home, "BOOKING", b);
    const fa = await feedOf(home, "AIRBNB");
    const fb = await feedOf(home, "BOOKING");
    expect(await syncFeed(fa.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 1 });
    expect(await syncFeed(fb.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 0, conflicts: 1 });
    const [c] = await listConflicts(sigma, { listingId: home, status: "OPEN" });
    expect(c.blockingSource).toBe("AIRBNB");
    // Its nights are exported as busy to the other platforms (here: Airbnb's export).
    as(admin);
    await act.issueExportLinkAction(home, "AIRBNB");
    const view = await listingChannels(sigma, home, ORIGIN);
    const file = view!.feeds.find((f) => f.source === "AIRBNB")!.exportUrl!.split("/").pop()!;
    const body = await (await icalGet(new Request(`${ORIGIN}/ical/${file}`), { params: Promise.resolve({ file }) })).text();
    expect(body).toContain(`DTSTART;VALUE=DATE:${ymd(day(462))}`);

    expect((await syncAct.resolveConflictAction(c.id, "DISMISS")).message).toMatch(/traité/);
    expect(await syncFeed(fb.id, { trigger: "SCHEDULED" })).toMatchObject({ conflicts: 0 });
    expect(await listConflicts(sigma, { listingId: home, status: "OPEN" })).toEqual([]);

    // Airbnb cancels: its nights are free, Booking.com's event moved a night → new conflict? No: free, imported.
    serve("/p-air.ics", { body: ics([{ uid: "p0@airbnb.com", from: 470, to: 471 }]) });
    expect(await syncFeed(fa.id, { trigger: "SCHEDULED" })).toMatchObject({ cancelled: 1 });
    expect(await syncFeed(fb.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 1, conflicts: 0 });
  });

  it("an open conflict whose nights are freed is imported (FREED); one whose event leaves the file is closed (EVENT_GONE)", async () => {
    const home = homes[4].id;
    const block = await db.booking.create({ data: { organizationId: sigma, listingId: home, source: "OWNER", adults: 0, checkIn: new Date(`${day(480)}T00:00:00Z`), checkOut: new Date(`${day(482)}T00:00:00Z`), note: "channels-test" } });
    const url = serve("/f.ics", { body: ics([{ uid: "f1", from: 480, to: 481 }, { uid: "f2", from: 481, to: 482 }]) });
    await setImport(home, "AGODA", url);
    const feed = await feedOf(home, "AGODA");
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ conflicts: 2 });
    await db.booking.update({ where: { id: block.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    serve("/f.ics", { body: ics([{ uid: "f1", from: 480, to: 481 }]) });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 1, conflicts: 0 });
    const all = await db.channelConflict.findMany({ where: { feedId: feed.id }, orderBy: { externalRef: "asc" } });
    expect(all.map((c) => [c.externalRef, c.status, c.resolution])).toEqual([
      ["f1", "RESOLVED", "FREED"],
      ["f2", "RESOLVED", "EVENT_GONE"],
    ]);
  });
});

// ---------- Failures ----------

describe("a feed that fails", () => {
  it("HTTP 500: journal error, no change, health FAILING then STALE after an hour, the team told once", async () => {
    const home = homes[5].id;
    const url = serve("/down.ics", { status: 500, body: "oops" });
    await setImport(home, "AIRBNB", url);
    const feed = await feedOf(home, "AIRBNB");
    const r = await syncFeed(feed.id, { trigger: "SCHEDULED" });
    expect(r).toMatchObject({ outcome: "ERROR", httpStatus: 500, errorCode: "HTTP_ERROR" });
    const f = await feedOf(home, "AIRBNB");
    expect([f.lastStatus, f.consecutiveFailures, f.lastSuccessAt]).toEqual(["ERROR", 1, null]);
    expect(feedHealth(f)).toBe("FAILING");
    expect((await syncAlerts(sigma)).failing).toBeGreaterThanOrEqual(1);
    as(admin);
    expect((await act.syncNowAction(home, "AIRBNB")).error).toMatch(/HTTP 500/);

    await db.channelFeed.update({ where: { id: feed.id }, data: { importUrlSetAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect(feedHealth(await feedOf(home, "AIRBNB"))).toBe("STALE");
    const first = await alertStaleFeeds();
    expect(first.alerted).toBeGreaterThanOrEqual(1);
    expect(notified.some((n) => n.kind === "channel_stale" && n.text.includes(homes[5].title))).toBe(true);
    notified.length = 0;
    await alertStaleFeeds();
    expect(notified.some((n) => n.text.includes(homes[5].title))).toBe(false);
  });

  it("timeout, invalid file, unknown host: journal errors, bookings untouched", async () => {
    const home = homes[5].id;
    const feed = await feedOf(home, "AIRBNB");
    setChannelAdapter(new IcalAdapter((req, o) => fetchFeed(req, { ...o, timeoutMs: 300 })));
    try {
      serve("/down.ics", { body: ics([{ uid: "x", from: 490, to: 491 }]), delayMs: 2000 });
      expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "ERROR", errorCode: "TIMEOUT" });
    } finally {
      setChannelAdapter(undefined);
    }
    serve("/down.ics", { body: "<html>Calendar not found</html>" });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "ERROR", errorCode: "INVALID_FILE" });
    serve("/down.ics", { body: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20270101\r\n" });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "ERROR", errorCode: "INVALID_FILE" });
    expect(await db.booking.count({ where: { channelFeedId: feed.id } })).toBe(0);
    // 500 twice (worker and « Synchroniser maintenant »), timeout, two invalid files.
    expect((await feedOf(home, "AIRBNB")).consecutiveFailures).toBe(5);
    // A good read clears the health.
    serve("/down.ics", { body: ics([{ uid: "x", from: 490, to: 491 }]) });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "SUCCESS", created: 1 });
    const f = await feedOf(home, "AIRBNB");
    expect([feedHealth(f), f.consecutiveFailures, f.staleAlertedAt]).toEqual(["OK", 0, null]);
  });

  it("ETag: the next read is conditional and a 304 changes nothing", async () => {
    const home = homes[6].id;
    const url = serve("/etag.ics", { body: ics([{ uid: "e1", from: 500, to: 502 }]), etag: '"v1"' });
    await setImport(home, "AIRBNB", url);
    const feed = await feedOf(home, "AIRBNB");
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "SUCCESS", created: 1 });
    expect((await feedOf(home, "AIRBNB")).etag).toBe('"v1"');
    const r = await syncFeed(feed.id, { trigger: "SCHEDULED" });
    expect(r).toMatchObject({ outcome: "NOT_MODIFIED", httpStatus: 304, created: 0 });
    expect(seen.filter((s) => s.path === "/etag.ics").map((s) => s.ifNoneMatch)).toEqual([undefined, '"v1"']);
    expect((await feedOf(home, "AIRBNB")).lastSuccessAt).not.toBeNull();
  });
});

// ---------- Export ----------

describe("export link", () => {
  it("every busy night except the platform's own, buffers and notice, no personal data; HEAD; revoke and regenerate", async () => {
    const home = homes[7].id;
    await db.listing.update({ where: { id: home }, data: { preparationDays: 1, minNoticeDays: 0 } });
    const direct = await db.booking.create({
      data: { organizationId: sigma, listingId: home, source: "DIRECT", guestName: "Zoubida Secret", guestPhone: "+212600000000", checkIn: new Date(`${day(520)}T00:00:00Z`), checkOut: new Date(`${day(523)}T00:00:00Z`), adults: 2, nightlyCents: 100, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 300, note: "channels-test" },
    });
    await db.booking.create({ data: { organizationId: sigma, listingId: home, source: "AIRBNB", externalRef: `HMEXP${Date.now()}`, guestName: "Airbnb Guest", checkIn: new Date(`${day(530)}T00:00:00Z`), checkOut: new Date(`${day(532)}T00:00:00Z`), adults: 1, note: "channels-test" } });
    as(admin);
    expect((await act.issueExportLinkAction(home, "AIRBNB")).error).toBeUndefined();
    const feed = await feedOf(home, "AIRBNB");
    expect(feed.exportTokenEnc).toMatch(ENVELOPE_RE);
    const url = (await listingChannels(sigma, home, ORIGIN))!.feeds.find((f) => f.source === "AIRBNB")!.exportUrl!;
    expect(url).toMatch(/^http:\/\/localhost:3100\/ical\/[A-Za-z0-9_-]{43}\.ics$/);
    const file = url.split("/").pop()!;
    const get = (f: string) => icalGet(new Request(`${ORIGIN}/ical/${f}`), { params: Promise.resolve({ file: f }) });

    const res = await get(file);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.text();
    // The direct stay with one preparation day each side; the Airbnb one isn't sent back to Airbnb.
    expect(body).toContain(`DTSTART;VALUE=DATE:${ymd(day(519))}\r\nDTEND;VALUE=DATE:${ymd(day(524))}`);
    expect(body).not.toContain(ymd(day(530)));
    expect(body).not.toMatch(/Zoubida|Secret|212600|Airbnb Guest|DIRECT/);
    expect(body).not.toContain(direct.id);
    // Booking.com's export of the same home does carry the Airbnb stay.
    await act.issueExportLinkAction(home, "BOOKING");
    const bk = (await listingChannels(sigma, home, ORIGIN))!.feeds.find((f) => f.source === "BOOKING")!.exportUrl!.split("/").pop()!;
    expect(await (await get(bk)).text()).toContain(`DTSTART;VALUE=DATE:${ymd(day(529))}`);

    const head = await icalHead(new Request(`${ORIGIN}/ical/${file}`, { method: "HEAD" }), { params: Promise.resolve({ file }) });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(new TextEncoder().encode(body).byteLength));
    expect(await head.text()).toBe("");

    expect((await get("x".repeat(43) + ".ics")).status).toBe(404);
    expect((await get(file.replace(".ics", ""))).status).toBe(404);

    // Regenerate: the old link stops at once.
    await act.issueExportLinkAction(home, "AIRBNB");
    expect((await get(file)).status).toBe(404);
    const renewed = (await listingChannels(sigma, home, ORIGIN))!.feeds.find((f) => f.source === "AIRBNB")!.exportUrl!.split("/").pop()!;
    expect(renewed).not.toBe(file);
    expect((await get(renewed)).status).toBe(200);
    expect((await act.revokeExportLinkAction(home, "AIRBNB")).error).toBeUndefined();
    expect((await get(renewed)).status).toBe(404);
    expect((await listingChannels(sigma, home, ORIGIN))!.feeds.find((f) => f.source === "AIRBNB")!).toMatchObject({ exportUrl: null, exportRevoked: true });
    const actions = (await db.auditLog.findMany({ where: { targetId: home, action: { startsWith: "channel.export" }, createdAt: { gte: t0 } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["channel.export_link_issued", "channel.export_link_issued", "channel.export_link_issued", "channel.export_link_revoked"]);
  });
});

// ---------- Booking rules ----------

describe("preparation days and minimum notice", () => {
  it("apply to the site's bookings; saved and audited by an associé only", async () => {
    const home = homes[7].id;
    as(admin);
    const form = new FormData();
    form.set("preparationDays", "2");
    form.set("minNoticeDays", "1");
    expect((await act.saveBookingRulesAction(home, {}, form)).message).toMatch(/Reportez-les/);
    form.set("preparationDays", "9");
    expect((await act.saveBookingRulesAction(home, {}, form)).error).toMatch(/0 à 7/);
    const l = await db.listing.findUniqueOrThrow({ where: { id: home }, select: { preparationDays: true, minNoticeDays: true, status: true } });
    expect([l.preparationDays, l.minNoticeDays]).toEqual([2, 1]);
    if (l.status !== "PUBLISHED") return;
    // The export test's stays are days 520–523 (direct) and 530–532 (Airbnb): arriving on 524 leaves one night of
    // preparation instead of two; 536 is clear of both with two nights on each side.
    const stay = (from: number, to: number) => ({ checkIn: day(from), checkOut: day(to), adults: 1, children: 0, infants: 0, pets: 0 });
    const far = addDays(today, 200);
    expect((await quoteStay(sigma, home, stay(524, 529), far)).available).toBe(false);
    expect((await quoteStay(sigma, home, stay(536, 541), far)).available).toBe(true);
    // Same-day arrival refused with one day of notice (today = the stay's arrival).
    await expect(quoteStay(sigma, home, stay(540, 543), new Date(`${day(540)}T00:00:00Z`))).rejects.toMatchObject({ code: "MIN_NOTICE" });
  });
});

// ---------- Worker ----------

describe("background worker", () => {
  it("advisory locks: a second holder is refused until the first releases", async () => {
    const a = new PgLocker();
    const b = new PgLocker();
    const key = `test:${Date.now()}`;
    const release = await a.tryLock(key);
    expect(release).not.toBeNull();
    expect(await b.tryLock(key)).toBeNull();
    await release!();
    const again = await b.tryLock(key);
    expect(again).not.toBeNull();
    await again!();
  });

  it("a feed being read is skipped by a second run", async () => {
    const feed = await feedOf(homes[6].id, "AIRBNB");
    const release = await new PgLocker().tryLock(`feed:${feed.id}`);
    try {
      expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ skipped: true, errorCode: "LOCKED" });
    } finally {
      await release!();
    }
  });

  it("reads the feeds that are due and schedules the next read 9–11 minutes later", async () => {
    const feed = await feedOf(homes[6].id, "AIRBNB");
    await db.channelFeed.updateMany({ where: { organizationId: sigma, id: { not: feed.id } }, data: { nextSyncAt: new Date(Date.now() + 3_600_000) } });
    await db.channelFeed.update({ where: { id: feed.id }, data: { nextSyncAt: new Date(Date.now() - 1000) } });
    const before = await db.channelSyncRun.count({ where: { feedId: feed.id } });
    const r = await syncDueFeeds();
    expect(r.read).toBeGreaterThanOrEqual(1);
    expect(await db.channelSyncRun.count({ where: { feedId: feed.id } })).toBe(before + 1);
    const next = (await feedOf(homes[6].id, "AIRBNB")).nextSyncAt.getTime() - Date.now();
    expect(next).toBeGreaterThan(8 * 60_000);
    expect(next).toBeLessThan(11 * 60_000 + 1000);
  });

  it("daily jobs: due once, recorded, the old Ma journée records purged", async () => {
    const job = DAILY_JOBS.find((j) => j.name === "task-sync-operations-purge")!;
    const user = await db.user.findFirstOrThrow({ where: { organizationId: sigma, role: "ADMIN" } });
    const old = await db.taskSyncOperation.create({ data: { organizationId: sigma, userId: user.id, opId: `old-${Date.now()}`, taskId: "x", kind: "start", outcome: "APPLIED", createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    const recent = await db.taskSyncOperation.create({ data: { organizationId: sigma, userId: user.id, opId: `new-${Date.now()}`, taskId: "x", kind: "start", outcome: "APPLIED" } });
    expect(await runDailyJob(job, { force: true })).toBe(true);
    expect(await db.taskSyncOperation.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.taskSyncOperation.findUnique({ where: { id: recent.id } })).not.toBeNull();
    const row = await db.scheduledJob.findUniqueOrThrow({ where: { name: job.name } });
    expect(row.lastOk).toBe(true);
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    // Not due again now.
    expect(await runDailyJob(job)).toBe(false);
    await db.taskSyncOperation.delete({ where: { id: recent.id } });
  });
});
