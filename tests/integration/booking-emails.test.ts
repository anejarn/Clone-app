import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmail, type TestEmail } from "../support/emails";

/**
 * Lot 7b through the real route, server actions and server functions: the booking e-mails (webhook auth, size and
 * rate limits, every body format; confirmation → booking at once, then the iCal import of the same stay adopts it,
 * and the other way round; modification, cancellation, conflict, manual queue and its actions, idempotency,
 * encryption at rest, retention), the price reminders (per connected feed, merged, cleared, done) and the connection
 * guide's ticks; who may do what (anonymous, guest, owner, agent, admin without 2FA refused; another organization:
 * « introuvable »). Seeded homes (the 8 after those of channels.test.ts), nights from day 640 to 729 (e-mails beyond
 * two years go to the queue), run-specific codes;
 * every row this file makes is deleted at the end.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const emailAct = await import("@/app/admin/synchronisation/email-actions");
const channelAct = await import("@/app/admin/biens/channel-actions");
const syncAct = await import("@/app/admin/synchronisation/actions");
const { POST: inboundPost } = await import("@/app/api/inbound-email/[token]/route");
const { GET: icalGet } = await import("@/app/ical/[file]/route");
const { db } = await import("@/lib/server/db");
const { inboundLimits } = await import("@/lib/server/channels/email/limits");
const { ingestInboundEmail } = await import("@/lib/server/channels/email/process");
const { listInboundEmails, applyPendingEmail } = await import("@/lib/server/channels/email/queue");
const { purgeInboundEmails } = await import("@/lib/server/channels/email/purge");
const { syncFeed } = await import("@/lib/server/channels/sync");
const { listingChannels } = await import("@/lib/server/channels/feeds");
const { listConflicts, syncAlerts } = await import("@/lib/server/channels/conflicts");
const { listPriceReminders } = await import("@/lib/server/channels/price-reminders");
const { createPriceRule, updatePriceRule, deletePriceRule } = await import("@/lib/server/admin/prices");
const { updateAdminListing } = await import("@/lib/server/admin/listings");
const { createStaffEntry } = await import("@/lib/server/admin/bookings");
const { closeLockPool } = await import("@/lib/server/jobs/locks");
const { pollInboundEmails } = await import("@/lib/server/jobs/worker");
const { setInboundEmailSources } = await import("@/lib/channels/email/sources");
const { setNotifier } = await import("@/lib/notifications");
const { ENVELOPE_RE } = await import("@/lib/secrets/envelope");
const { isoDay } = await import("@/lib/admin/calendar");
const { listingToFormValues, parseListingForm } = await import("@/lib/admin/listing-form");
const { saveListingMapping } = await import("@/lib/server/channels/feeds");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const sigma = await sigmaOrgId();
const ORIGIN = "http://localhost:3100";
const RUN = String(Date.now()).slice(-6);
const t0 = new Date();
/** Airbnb codes: HM + 8 letters or digits. */
const hm = (n: number) => `HM${RUN}${String(n).padStart(2, "0")}`;
/** Booking.com / Agoda codes: 10 digits. */
const num = (prefix: number, n: number) => `${prefix}${RUN}${String(n).padStart(2, "0")}`;
const at = (n: number) => new Date(`${day(n)}T00:00:00Z`);

interface Member {
  headers: Headers;
  actor: Authorized;
}
let admin: Member;
let otherAdmin: Member;
let otherOrg: string;
const refusers: Record<string, Headers> = {};
const as = (m: { headers: Headers }) => {
  ctx.headers = m.headers;
};
let homes: { id: string; title: string; priceCents: number; minNights: number; cleaningFeeCents: number; lat: number; lng: number }[];
const notified: { kind: string; text: string }[] = [];

// ---------- Local iCal feed server ----------

const routes = new Map<string, string>();
let server: http.Server;
let base: string;
const ymd = (iso: string) => iso.replaceAll("-", "");
function ics(events: { uid: string; from: number; to: number; summary?: string; description?: string }[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Feed//EN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTART;VALUE=DATE:${ymd(day(e.from))}`, `DTEND;VALUE=DATE:${ymd(day(e.to))}`, `SUMMARY:${e.summary ?? "Reserved"}`);
    if (e.description) lines.push(`DESCRIPTION:${e.description}`);
    lines.push("END:VEVENT");
  }
  return [...lines, "END:VCALENDAR", ""].join("\r\n");
}

async function member(role: "ADMIN" | "AGENT" | "OWNER" | "GUEST", organizationId: string | null, twoFactor = true): Promise<Member> {
  const { user, headers } = await signedInMember({ role, organizationId, twoFactor });
  return { headers, actor: { user: { id: user.id, name: user.name, email: user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" } };
}

/** The e-mail's stay, as a TestEmail with nights relative to today. */
const mail = (e: Omit<TestEmail, "checkIn" | "checkOut"> & { from: number; to: number }): string => buildEmail({ ...e, checkIn: day(e.from), checkOut: day(e.to) });

async function drop(raw: string) {
  as(admin);
  const form = new FormData();
  form.set("raw", raw);
  return emailAct.dropEmailAction({}, form);
}

const bookingByCode = (source: "AIRBNB" | "BOOKING" | "AGODA", code: string) =>
  db.booking.findFirst({ where: { organizationId: sigma, source, externalRef: code }, include: { tasks: { select: { type: true, status: true, scheduledDate: true } } } });

async function feedOf(listingId: string, source: "AIRBNB" | "BOOKING" | "AGODA") {
  return db.channelFeed.findUniqueOrThrow({ where: { listingId_source: { listingId, source } } });
}

async function setImport(listingId: string, source: string, path: string, body: string) {
  routes.set(path, body);
  as(admin);
  const form = new FormData();
  form.set("url", `${base}${path}`);
  const r = await channelAct.setImportUrlAction(listingId, source, {}, form);
  expect(r.error).toBeUndefined();
}

/**
 * Seeded homes share titles: each test home gets its platform id on its feed (Biens → Plateformes → « Nom de ce bien
 * sur la plateforme »), and the e-mails name the home by that id.
 */
async function mapHome(i: number, source: "AIRBNB" | "BOOKING" | "AGODA") {
  const platformListingId = `${i}${RUN}`;
  await saveListingMapping(admin.actor, homes[i].id, source, { platformListingId, platformListingName: "" });
  return { listingId: platformListingId, listingName: `Annonce ${source.toLowerCase()} ${i}` };
}

let webhookUrl: string;
const tokenOf = (url: string) => url.split("/").pop()!;
const post = (token: string, body: BodyInit, headers: Record<string, string> = { "content-type": "message/rfc822" }) =>
  inboundPost(new Request(`${ORIGIN}/api/inbound-email/${token}`, { method: "POST", body, headers, duplex: "half" } as RequestInit), { params: Promise.resolve({ token }) });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = routes.get((req.url ?? "").split("?")[0]);
    if (!body) res.writeHead(404).end();
    else res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `emails-${Date.now()}` } })).id;
  admin = await member("ADMIN", sigma);
  otherAdmin = await member("ADMIN", otherOrg);
  refusers.anonymous = new Headers();
  refusers.guest = (await member("GUEST", null, false)).headers;
  refusers.owner = (await member("OWNER", sigma, false)).headers;
  refusers.agent = (await member("AGENT", sigma)).headers;
  refusers["admin without 2FA"] = (await member("ADMIN", sigma, false)).headers;
  homes = await db.listing.findMany({
    where: { organizationId: sigma, category: "HOME" },
    select: { id: true, title: true, priceCents: true, minNights: true, cleaningFeeCents: true, lat: true, lng: true },
    orderBy: { id: "desc" },
    skip: 8,
    take: 8,
  });
  // Leftovers of an interrupted earlier run on these homes and nights.
  await cleanup();
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
  inboundLimits.reset();
});

async function cleanup() {
  const ids = homes.map((h) => h.id);
  await db.channelConflict.deleteMany({ where: { listingId: { in: ids } } });
  await db.booking.deleteMany({ where: { listingId: { in: ids }, checkIn: { gte: at(600) } } });
  await db.priceReminder.deleteMany({ where: { listingId: { in: ids } } });
  await db.channelFeed.deleteMany({ where: { listingId: { in: ids } } });
  await db.inboundEmail.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { organizationId: sigma, receivedAt: { gte: t0 } }] } });
  await db.priceRule.deleteMany({ where: { organizationId: sigma, name: { startsWith: "Test 7b" } } });
}

afterAll(async () => {
  setNotifier(undefined);
  setInboundEmailSources(undefined);
  await cleanup();
  // The listings' prices changed by the reminder tests are put back.
  for (const h of homes) await db.listing.update({ where: { id: h.id }, data: { priceCents: h.priceCents, minNights: h.minNights, cleaningFeeCents: h.cleaningFeeCents, lat: h.lat, lng: h.lng } });
  await db.organization.update({ where: { id: sigma }, data: { inboundEmailTokenHash: null, inboundEmailTokenEnc: null, inboundEmailTokenIssuedAt: null } });
  await db.auditLog.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { organizationId: otherOrg } });
  await db.organization.delete({ where: { id: otherOrg } });
  await closeLockPool();
  await new Promise((r) => server.close(r));
});

// ---------- Access ----------

describe("who may handle booking e-mails, price reminders and the guide", () => {
  it("anonymous, guests, owners, agents and admins without 2FA are refused every action", async () => {
    const before = await db.inboundEmail.count({ where: { organizationId: sigma } });
    for (const [who, headers] of Object.entries(refusers)) {
      ctx.headers = headers;
      const form = new FormData();
      form.set("raw", mail({ platform: "AIRBNB", kind: "CONFIRMATION", code: hm(99), from: 640, to: 642 }));
      form.set("listingId", homes[0].id);
      for (const r of [
        await emailAct.dropEmailAction({}, form),
        await emailAct.applyEmailAction("c0000000000000000000000000", {}, form),
        await emailAct.createBookingFromEmailAction("c0000000000000000000000000", {}, form),
        await emailAct.ignoreEmailAction("c0000000000000000000000000"),
        await emailAct.issueInboundAddressAction(),
        await emailAct.revokeInboundAddressAction(),
        await emailAct.markPriceReminderDoneAction("c0000000000000000000000000"),
        await channelAct.saveListingMappingAction(homes[0].id, "AIRBNB", {}, form),
        await channelAct.setSetupTickAction(homes[0].id, "AIRBNB", "rulesSet", true),
      ]) {
        expect(r.error, who).toMatch(/Connectez-vous|Accès refusé|double authentification/);
      }
    }
    expect(await db.inboundEmail.count({ where: { organizationId: sigma } })).toBe(before);
    expect(await db.channelFeed.count({ where: { listingId: homes[0].id } })).toBe(0);
    expect((await db.organization.findUniqueOrThrow({ where: { id: sigma } })).inboundEmailTokenHash).toBeNull();
  });

  it("another organization's admin finds nothing of Sigma's", async () => {
    as(otherAdmin);
    const form = new FormData();
    form.set("platformListingId", "1");
    expect((await channelAct.saveListingMappingAction(homes[0].id, "AIRBNB", {}, form)).error).toBe("Bien introuvable.");
    expect((await channelAct.setSetupTickAction(homes[0].id, "AIRBNB", "rulesSet", true)).error).toBe("Bien introuvable.");
    // An e-mail dropped by the other organization matches none of Sigma's homes.
    const f = new FormData();
    f.set("raw", mail({ platform: "BOOKING", kind: "CONFIRMATION", code: num(41, 99), from: 640, to: 642, listingName: homes[0].title }));
    const r = await emailAct.dropEmailAction({}, f);
    expect(r.message).toMatch(/logement non reconnu/);
    expect(await bookingByCode("BOOKING", num(41, 99))).toBeNull();
    const [mine] = await listInboundEmails(otherOrg);
    expect(mine.reason).toBe("NO_LISTING");
    // Sigma's admin can't act on it, nor the other admin on Sigma's.
    as(admin);
    expect((await emailAct.ignoreEmailAction(mine.id)).error).toBe("E-mail introuvable.");
    const g = new FormData();
    g.set("listingId", homes[0].id);
    as(otherAdmin);
    expect((await emailAct.applyEmailAction(mine.id, {}, g)).error).toBe("Bien introuvable.");
    expect(await listInboundEmails(sigma, "PENDING").then((l) => l.some((e) => e.id === mine.id))).toBe(false);
  });
});

// ---------- Webhook ----------

describe("the receiving webhook", () => {
  it("no address: 404; issued: accepts message/rfc822, JSON and multipart; wrong or revoked token: 404", async () => {
    expect((await post("x".repeat(43), "x")).status).toBe(404);
    as(admin);
    expect((await emailAct.issueInboundAddressAction()).message).toMatch(/Adresse de réception créée/);
    const org = await db.organization.findUniqueOrThrow({ where: { id: sigma } });
    expect(org.inboundEmailTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(org.inboundEmailTokenEnc).toMatch(ENVELOPE_RE);
    const { inboundAddress } = await import("@/lib/server/channels/email/address");
    webhookUrl = (await inboundAddress(sigma, ORIGIN)).url!;
    expect(webhookUrl).toMatch(/^http:\/\/localhost:3100\/api\/inbound-email\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(webhookUrl);

    const spam = "From: promo@deals.test\r\nSubject: You won!\r\nMessage-ID: <spam-" + RUN + "@deals.test>\r\n\r\nClick here.";
    const r1 = await post(token, spam);
    expect(r1.status).toBe(202);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    expect(await r1.json()).toMatchObject({ status: "IGNORED", duplicate: false });
    // The same message again: the first outcome.
    expect(await (await post(token, spam)).json()).toMatchObject({ status: "IGNORED", duplicate: true });

    const json = await post(token, JSON.stringify({ raw: spam.replace("spam-", "spam-json-") }), { "content-type": "application/json" });
    expect(json.status).toBe(202);
    const b64 = await post(token, JSON.stringify({ raw: Buffer.from(spam.replace("spam-", "spam-b64-")).toString("base64"), encoding: "base64" }), { "content-type": "application/json" });
    expect(b64.status).toBe(202);
    const fd = new FormData();
    fd.set("body-mime", spam.replace("spam-", "spam-form-"));
    expect((await inboundPost(new Request(`${ORIGIN}/api/inbound-email/${token}`, { method: "POST", body: fd }), { params: Promise.resolve({ token }) })).status).toBe(202);

    expect((await post(token, "x", { "content-type": "image/png" })).status).toBe(415);
    expect((await post(token, "{", { "content-type": "application/json" })).status).toBe(400);
    expect((await post(token, JSON.stringify({ raw: 1 }), { "content-type": "application/json" })).status).toBe(400);
    expect((await post(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), spam)).status).toBe(404);
    expect((await post("not-a-token", spam)).status).toBe(404);
  });

  it("refuses more than 5 MB (declared or streamed), empty bodies; rate-limits bad tokens and each organization", async () => {
    const token = tokenOf(webhookUrl);
    const big = new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61);
    expect((await post(token, big)).status).toBe(413);
    expect((await post(token, new Blob([big]).stream() as unknown as BodyInit, { "content-type": "message/rfc822" })).status).toBe(413);
    expect((await post(token, "")).status).toBe(400);

    const bad = { "content-type": "message/rfc822", "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 20; i++) expect((await post("y".repeat(43), "x", bad)).status).toBe(404);
    expect((await post(token, "x", bad)).status).toBe(429);
    // Another client is not blocked.
    expect((await post(token, "From: a@b.test\r\nMessage-ID: <rl-" + RUN + "@b.test>\r\n\r\nhello", { "content-type": "message/rfc822", "x-forwarded-for": "203.0.113.8" })).status).toBe(202);

    for (let i = 0; i < 120; i++) inboundLimits.perOrganization.take(sigma);
    const limited = await post(token, "From: a@b.test\r\nMessage-ID: <rl2-" + RUN + "@b.test>\r\n\r\nhello");
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("TOO_MANY_REQUESTS");
  });

  it("a confirmation received by the webhook blocks the dates at once; revoking the address stops it", async () => {
    const token = tokenOf(webhookUrl);
    const code = num(42, 1);
    const raw = mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 640, to: 643, guest: "Webhook Test", adults: 2, amount: "1 800,00 MAD", ...(await mapHome(1, "BOOKING")) });
    const r = await post(token, raw);
    expect(await r.json()).toMatchObject({ status: "PROCESSED", duplicate: false });
    const b = await bookingByCode("BOOKING", code);
    expect([b?.listingId, b?.status, isoDay(b!.checkIn), isoDay(b!.checkOut), b?.channelFeedId]).toEqual([homes[1].id, "CONFIRMED", day(640), day(643), null]);
    as(admin);
    expect((await emailAct.revokeInboundAddressAction()).message).toMatch(/révoquée/);
    expect((await post(token, raw)).status).toBe(404);
    expect((await emailAct.revokeInboundAddressAction()).error).toMatch(/Aucune adresse/);
  });
});

// ---------- Processing ----------

describe("a confirmation e-mail", () => {
  it("creates the booking at once (guest, guests, amount, tasks), blocks the dates, encrypts the message, audits without personal data", async () => {
    const home = homes[0];
    as(admin);
    const map = new FormData();
    map.set("platformListingId", `77${RUN}`);
    map.set("platformListingName", "");
    expect((await channelAct.saveListingMappingAction(home.id, "AIRBNB", {}, map)).message).toMatch(/Correspondance enregistrée/);
    const code = hm(1);
    const raw = mail({ platform: "AIRBNB", kind: "CONFIRMATION", code, from: 650, to: 653, guest: "Camille Testeur", adults: 2, children: 1, amount: "4 512,00 MAD", listingId: `77${RUN}`, messageId: `conf-${RUN}@airbnb.test` });
    const r = await drop(raw);
    expect(r.message).toBe("Réservation créée : les dates sont bloquées.");
    const b = (await bookingByCode("AIRBNB", code))!;
    expect(b).toMatchObject({ listingId: home.id, status: "CONFIRMED", guestName: "Camille Testeur", adults: 2, children: 1, channelFeedId: null, platformAmountCents: 451_200, platformCurrency: "MAD", platformAmountKind: "PAYOUT", totalCents: 451_200 });
    expect(b.tasks.map((t) => t.type).sort()).toEqual(["CHECKIN", "CLEANING", "LINEN"]);
    expect(r.bookingId).toBe(b.id);
    // The nights are taken for everybody.
    const entry = { kind: "blocage" as const, listingId: home.id, checkIn: at(651), checkOut: at(652), note: "test" };
    await expect(createStaffEntry(admin.actor, entry as never)).rejects.toMatchObject({ code: "UNAVAILABLE" });

    const row = await db.inboundEmail.findFirstOrThrow({ where: { organizationId: sigma, externalRef: code } });
    expect(row).toMatchObject({ status: "PROCESSED", outcome: "CREATED", source: "AIRBNB", kind: "CONFIRMATION", listingId: home.id, bookingId: b.id, senderDomain: "airbnb.com", via: "MANUAL", createdById: admin.actor.user.id });
    expect(Buffer.from(row.rawEnc!).subarray(0, 4).toString()).toBe("SGE1");
    expect(Buffer.from(row.rawEnc!).toString("latin1")).not.toContain("Camille");
    expect(row.detailsEnc).toMatch(ENVELOPE_RE);
    expect(JSON.stringify(row)).not.toContain("Camille");
    const audit = await db.auditLog.findMany({ where: { organizationId: sigma, OR: [{ targetId: row.id }, { targetId: b.id }] } });
    expect(audit.map((a) => a.action).sort()).toEqual(["channel.email_booking_created", "channel.email_received"]);
    expect(JSON.stringify(audit)).not.toContain("Camille");

    // Idempotent: the same message (Message-ID), then the same content forwarded (another Message-ID).
    expect((await drop(raw)).message).toMatch(/déjà été reçu/);
    const fwd = raw.replace(`conf-${RUN}@airbnb.test`, `fwd-${RUN}@gmail.test`);
    expect((await drop(fwd)).message).toMatch(/Même contenu/);
    expect(await db.booking.count({ where: { organizationId: sigma, source: "AIRBNB", externalRef: code } })).toBe(1);
    expect(await db.inboundEmail.count({ where: { organizationId: sigma, externalRef: code } })).toBe(2);
  });

  it("then the iCal import of the same stay adopts it (Airbnb: same code), no duplicate, no cancellation", async () => {
    const home = homes[0];
    const code = hm(1);
    await setImport(home.id, "AIRBNB", `/a-${RUN}.ics`, ics([{ uid: `u-${RUN}@airbnb.com`, from: 650, to: 653, description: `https://www.airbnb.com/hosting/reservations/details/${code}` }]));
    const feed = await feedOf(home.id, "AIRBNB");
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "SUCCESS", created: 0, updated: 1, conflicts: 0 });
    const b = (await bookingByCode("AIRBNB", code))!;
    expect([b.channelFeedId, b.guestName, b.status]).toEqual([feed.id, "Camille Testeur", "CONFIRMED"]);
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(await db.booking.count({ where: { listingId: home.id, status: "CONFIRMED", checkIn: { gte: at(600) } } })).toBe(1);
  });

  it("Booking.com: the e-mail first, the feed (no code, CLOSED) adopts it by its nights and keeps the code", async () => {
    const home = homes[2];
    const code = num(43, 1);
    const r = await drop(mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 660, to: 664, guest: "Alex Placeholder", adults: 2, amount: "€ 480.00", ...(await mapHome(2, "BOOKING")) }));
    expect(r.message).toMatch(/Réservation créée/);
    const created = (await bookingByCode("BOOKING", code))!;
    expect([created.platformAmountCents, created.platformCurrency, created.platformAmountKind, created.totalCents]).toEqual([48_000, "EUR", "GUEST_TOTAL", null]);
    await setImport(home.id, "BOOKING", `/b-${RUN}.ics`, ics([{ uid: `bk-${RUN}@booking.com`, from: 660, to: 664, summary: "CLOSED - Not available" }]));
    const feed = await feedOf(home.id, "BOOKING");
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ outcome: "SUCCESS", created: 0, updated: 1, conflicts: 0 });
    const b = (await bookingByCode("BOOKING", code))!;
    expect([b.id, b.channelFeedId, b.channelEventRef, b.externalRef, b.guestName]).toEqual([created.id, feed.id, `bk-${RUN}@booking.com`, code, "Alex Placeholder"]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: b.id, action: "channel.booking_adopted" } });
    expect(audit.details).toMatchObject({ byNights: true });
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 0, updated: 0, cancelled: 0, conflicts: 0 });
    // The modification e-mail re-dates it; the feed's next read (moved too) keeps the same booking.
    const mod = await drop(mail({ platform: "BOOKING", kind: "MODIFICATION", code, from: 661, to: 665, guest: "Alex Placeholder", adults: 3, amount: "€ 540.00" }));
    expect(mod.message).toBe("Réservation déplacée aux nouvelles dates.");
    const moved = (await bookingByCode("BOOKING", code))!;
    expect([isoDay(moved.checkIn), isoDay(moved.checkOut), moved.adults, moved.platformAmountCents]).toEqual([day(661), day(665), 3, 54_000]);
    expect(moved.tasks.find((t) => t.type === "CLEANING")!.scheduledDate.toISOString().slice(0, 10)).toBe(day(665));
    routes.set(`/b-${RUN}.ics`, ics([{ uid: `bk-${RUN}@booking.com`, from: 661, to: 665, summary: "CLOSED - Not available" }]));
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 0, updated: 0, cancelled: 0, conflicts: 0 });
  });

  it("Booking.com: the feed first (placeholder), then the e-mail completes it; the feed still recognizes it", async () => {
    const home = homes[3];
    await setImport(home.id, "BOOKING", `/c-${RUN}.ics`, ics([{ uid: `ph-${RUN}@booking.com`, from: 670, to: 672, summary: "CLOSED - Not available" }]));
    const feed = await feedOf(home.id, "BOOKING");
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 1 });
    const placeholder = await db.booking.findFirstOrThrow({ where: { channelFeedId: feed.id } });
    expect([placeholder.externalRef, placeholder.guestName, placeholder.adults]).toEqual([`ph-${RUN}@booking.com`, null, 1]);
    const code = num(44, 1);
    const r = await drop(mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 670, to: 672, guest: "Inès Exemple", adults: 2, amount: "3 450,00 MAD", ...(await mapHome(3, "BOOKING")) }));
    expect(r.message).toMatch(/Réservation complétée/);
    const b = await db.booking.findUniqueOrThrow({ where: { id: placeholder.id } });
    expect([b.externalRef, b.channelEventRef, b.guestName, b.adults, b.totalCents, b.channelFeedId]).toEqual([code, `ph-${RUN}@booking.com`, "Inès Exemple", 2, 345_000, feed.id]);
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(await db.booking.count({ where: { listingId: home.id, status: "CONFIRMED", checkIn: { gte: at(600) } } })).toBe(1);
    // The platform drops it from its feed: cancelled by the feed as before.
    routes.set(`/c-${RUN}.ics`, ics([{ uid: `other-${RUN}`, from: 690, to: 691 }]));
    expect(await syncFeed(feed.id, { trigger: "SCHEDULED" })).toMatchObject({ cancelled: 1 });
  });
});

describe("cancellation, conflicts and the queue", () => {
  it("a cancellation cancels only the booking of that platform and code; unknown code → queue", async () => {
    const home = homes[4];
    const code = num(45, 1);
    await drop(mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 680, to: 682, guest: "Annul Test", ...(await mapHome(4, "BOOKING")) }));
    // An Agoda booking with the same number, elsewhere on the home, is not touched.
    const agoda = await db.booking.create({ data: { organizationId: sigma, listingId: home.id, source: "AGODA", externalRef: code, checkIn: at(690), checkOut: at(692), adults: 1 } });
    const r = await drop(mail({ platform: "BOOKING", kind: "CANCELLATION", code, from: 680, to: 682 }));
    expect(r.message).toBe("Réservation annulée : les dates sont libérées.");
    const b = (await bookingByCode("BOOKING", code))!;
    expect(b.status).toBe("CANCELLED");
    expect(b.tasks.every((t) => t.status === "CANCELLED")).toBe(true);
    expect((await db.booking.findUniqueOrThrow({ where: { id: agoda.id } })).status).toBe("CONFIRMED");
    // The same cancellation forwarded again: same content; another cancellation e-mail of it: nothing to change.
    expect((await drop(mail({ platform: "BOOKING", kind: "CANCELLATION", code, from: 680, to: 682 }))).message).toMatch(/Même contenu/);
    expect((await drop(mail({ platform: "BOOKING", kind: "CANCELLATION", code, from: 680, to: 682, adults: 1 }))).message).toMatch(/Rien à changer/);
    const unknown = await drop(mail({ platform: "BOOKING", kind: "CANCELLATION", code: num(45, 9), from: 680, to: 682 }));
    expect(unknown.message).toMatch(/réservation introuvable/);
    expect(notified.some((n) => n.kind === "booking_email_pending")).toBe(true);
  });

  it("a failed DKIM check never cancels on its own; an associé can apply it", async () => {
    const code = hm(5);
    await drop(mail({ platform: "AIRBNB", kind: "CONFIRMATION", code, from: 700, to: 702, ...(await mapHome(4, "AIRBNB")) }));
    expect((await bookingByCode("AIRBNB", code))!.status).toBe("CONFIRMED");
    const r = await drop(mail({ platform: "AIRBNB", kind: "CANCELLATION", code, from: 700, to: 702, headers: ["Authentication-Results: mx.test; dkim=fail header.d=airbnb.com; dmarc=fail"] }));
    expect(r.message).toMatch(/non authentifié/);
    expect((await bookingByCode("AIRBNB", code))!.status).toBe("CONFIRMED");
    as(admin);
    expect((await emailAct.applyEmailAction(r.emailId!, {}, new FormData())).message).toMatch(/annulée/);
    expect((await bookingByCode("AIRBNB", code))!.status).toBe("CANCELLED");
    expect((await db.inboundEmail.findUniqueOrThrow({ where: { id: r.emailId } })).resolvedById).toBe(admin.actor.user.id);
  });

  it("nights already taken → a conflict (origin e-mail), notified, exported as busy; replaced → the booking gets the e-mail's details", async () => {
    const home = homes[5];
    const block = await db.booking.create({ data: { organizationId: sigma, listingId: home.id, source: "OWNER", adults: 0, checkIn: at(700), checkOut: at(705) } });
    const code = num(46, 1);
    const where = await mapHome(5, "BOOKING");
    const r = await drop(mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 702, to: 704, guest: "Conflit Test", adults: 2, amount: "900,00 MAD", ...where }));
    expect(r.message).toMatch(/Double réservation/);
    expect(await bookingByCode("BOOKING", code)).toBeNull();
    const [c] = await listConflicts(sigma, { listingId: home.id, status: "OPEN" });
    expect(c).toMatchObject({ source: "BOOKING", externalRef: code, origin: "EMAIL", checkIn: day(702), checkOut: day(704), blockingBookingId: block.id, blockingSource: "OWNER" });
    expect(notified.find((n) => n.kind === "channel_conflict")!.text).toContain(home.title);
    // Airbnb's export carries the conflict's nights.
    as(admin);
    await channelAct.issueExportLinkAction(home.id, "AIRBNB");
    const file = (await listingChannels(sigma, home.id, ORIGIN))!.feeds.find((f) => f.source === "AIRBNB")!.exportUrl!.split("/").pop()!;
    expect(await (await icalGet(new Request(`${ORIGIN}/ical/${file}`), { params: Promise.resolve({ file }) })).text()).toContain(`DTSTART;VALUE=DATE:${ymd(day(700))}`);
    // The same e-mail forwarded again: no second conflict.
    await drop(mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 702, to: 704, guest: "Conflit Test", adults: 2, amount: "900,00 MAD", ...where, messageId: `again-${RUN}@x.test` }));
    expect(await db.channelConflict.count({ where: { listingId: home.id, status: "OPEN" } })).toBe(1);

    expect((await syncAct.resolveConflictAction(c.id, "REPLACE")).message).toMatch(/annulée/);
    const b = (await bookingByCode("BOOKING", code))!;
    expect([b.status, b.channelFeedId, b.guestName, b.adults, b.totalCents]).toEqual(["CONFIRMED", null, "Conflit Test", 2, 90_000]);
    expect((await db.booking.findUniqueOrThrow({ where: { id: block.id } })).status).toBe("CANCELLED");
  });

  it("unknown platform → queue → booking created by hand; spam → ignored; home not recognized → applied with the home chosen, remembered for the next e-mail", async () => {
    const unknown = await drop(mail({ platform: "UNKNOWN", kind: "CONFIRMATION", code: `PX-${RUN}`, from: 710, to: 713, adults: 2 }));
    expect(unknown.message).toMatch(/plateforme non reconnue/);
    const pending = await listInboundEmails(sigma, "PENDING");
    const item = pending.find((e) => e.id === unknown.emailId)!;
    expect(item).toMatchObject({ source: null, checkIn: day(710), checkOut: day(713), reason: "NOT_RECOGNIZED" });
    expect(item.details?.excerpt).toContain(`PX-${RUN}`);
    expect((await syncAlerts(sigma)).emailsPending).toBeGreaterThanOrEqual(1);
    as(admin);
    const form = new FormData();
    for (const [k, v] of Object.entries({ listingId: homes[6].id, source: "OTHER", externalRef: `PX-${RUN}`, checkIn: day(710), checkOut: day(713), adults: "2", children: "0", infants: "0", pets: "0", guestName: "Saisie Test", total: "" })) form.set(k, v);
    const created = await emailAct.createBookingFromEmailAction(unknown.emailId!, {}, form);
    expect(created.message).toMatch(/Réservation créée/);
    expect(await db.booking.findFirst({ where: { organizationId: sigma, source: "OTHER", externalRef: `PX-${RUN}`, status: "CONFIRMED" } })).not.toBeNull();
    expect((await db.inboundEmail.findUniqueOrThrow({ where: { id: unknown.emailId } })).status).toBe("PROCESSED");
    expect((await emailAct.createBookingFromEmailAction(unknown.emailId!, {}, form)).error).toMatch(/déjà été traité/);

    const spam = await drop("From: promo@deals.test\r\nSubject: Big sale\r\nMessage-ID: <sp2-" + RUN + "@deals.test>\r\n\r\nBuy now.");
    expect(spam.message).toMatch(/E-mail ignoré/);
    const message = await drop("From: Airbnb <automated@airbnb.com>\r\nSubject: New message from a guest\r\nMessage-ID: <msg-" + RUN + "@airbnb.test>\r\n\r\nHello, can we arrive early?");
    expect(message.message).toMatch(/E-mail ignoré/);

    const agodaName = `Riad Agoda ${RUN}`;
    const code = num(47, 1);
    const r = await drop(mail({ platform: "AGODA", kind: "CONFIRMATION", code, from: 720, to: 723, guest: "Sam Fictif", adults: 2, amount: "USD 300.00", listingName: agodaName, listingId: `88${RUN}` }));
    expect(r.message).toMatch(/logement non reconnu/);
    const apply = new FormData();
    apply.set("listingId", homes[7].id);
    apply.set("remember", "on");
    expect((await emailAct.applyEmailAction(r.emailId!, {}, apply)).message).toMatch(/Réservation créée/);
    expect((await bookingByCode("AGODA", code))!.listingId).toBe(homes[7].id);
    expect(await feedOf(homes[7].id, "AGODA")).toMatchObject({ platformListingId: `88${RUN}`, platformListingName: agodaName });
    const next = await drop(mail({ platform: "AGODA", kind: "CONFIRMATION", code: num(47, 2), from: 724, to: 725, listingName: agodaName, listingId: `88${RUN}` }));
    expect(next.message).toMatch(/Réservation créée/);
    expect((await bookingByCode("AGODA", num(47, 2)))!.listingId).toBe(homes[7].id);
    // Ignoring.
    const other = await drop(mail({ platform: "UNKNOWN", kind: "CONFIRMATION", code: `PY-${RUN}`, from: 725, to: 726 }));
    expect((await emailAct.ignoreEmailAction(other.emailId!)).message).toBe("E-mail ignoré.");
    expect((await emailAct.ignoreEmailAction(other.emailId!)).error).toMatch(/déjà été traité/);
    expect((await listInboundEmails(sigma, "IGNORED")).some((e) => e.id === other.emailId && e.reason === "IGNORED_BY_HAND")).toBe(true);
    // Applying an e-mail with another organization's home is refused.
    const again = await drop(mail({ platform: "AGODA", kind: "CONFIRMATION", code: num(47, 3), from: 726, to: 727, listingName: "Inconnu" }));
    await expect(applyPendingEmail(admin.actor, again.emailId!, { listingId: "c0000000000000000000000000" })).rejects.toMatchObject({ status: 404 });
  });

  it("a pull source is read by the worker into the same processing", async () => {
    const code = num(48, 1);
    setInboundEmailSources([
      {
        id: "test",
        organizations: async () => [sigma],
        fetchNew: async () => [{ raw: new TextEncoder().encode(mail({ platform: "BOOKING", kind: "CONFIRMATION", code, from: 726, to: 728, listingId: `1${RUN}`, listingName: "Annonce" })) }],
      },
    ]);
    try {
      expect(await pollInboundEmails()).toEqual({ received: 1, failed: 0 });
    } finally {
      setInboundEmailSources(undefined);
    }
    expect((await bookingByCode("BOOKING", code))!.listingId).toBe(homes[1].id);
    expect((await db.inboundEmail.findFirstOrThrow({ where: { organizationId: sigma, externalRef: code } })).via).toBe("WEBHOOK");
  });

  it("retention: raw messages and details are erased after 30 days, a waiting one keeps its details", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    const done = await ingestInboundEmail({ organizationId: sigma, raw: new TextEncoder().encode("From: a@b.test\r\nMessage-ID: <old1-" + RUN + "@b.test>\r\n\r\nx"), via: "MANUAL", now: old });
    const waiting = await ingestInboundEmail({ organizationId: sigma, raw: new TextEncoder().encode(mail({ platform: "UNKNOWN", kind: "CONFIRMATION", code: `PZ-${RUN}`, from: 727, to: 728 })), via: "MANUAL", now: old });
    expect(waiting.status).toBe("PENDING");
    const r = await purgeInboundEmails();
    expect(r.raw).toBeGreaterThanOrEqual(2);
    const [d, w] = await Promise.all([db.inboundEmail.findUniqueOrThrow({ where: { id: done.id } }), db.inboundEmail.findUniqueOrThrow({ where: { id: waiting.id } })]);
    expect([d.rawEnc, d.detailsEnc, d.purgedAt !== null]).toEqual([null, null, true]);
    expect([w.rawEnc, typeof w.detailsEnc]).toEqual([null, "string"]);
    await db.inboundEmail.deleteMany({ where: { id: { in: [done.id, waiting.id] } } });
  });
});

// ---------- Price reminders ----------

describe("price reminders", () => {
  const ruleInput = (listingId: string, bps: number) => ({
    kind: "SEASON" as const,
    name: `Test 7b ${RUN}`,
    startDate: at(800),
    endDate: at(830),
    recurring: false,
    adjustment: { type: "PERCENT" as const, bps },
    minNights: null,
    priority: 0,
    allListings: false,
    listingIds: [listingId],
  });

  it("one per connected platform of the homes concerned, merged while open, cleared when back, done per platform", async () => {
    const home = homes[6];
    as(admin);
    await channelAct.issueExportLinkAction(home.id, "AIRBNB");
    await channelAct.issueExportLinkAction(home.id, "BOOKING");
    await channelAct.issueExportLinkAction(home.id, "AGODA");
    await channelAct.revokeExportLinkAction(home.id, "AGODA");
    const { id: ruleId } = await createPriceRule(admin.actor, ruleInput(home.id, 2000));
    let open = await listPriceReminders(sigma, { listingId: home.id });
    expect(open.map((r) => r.source).sort()).toEqual(["AIRBNB", "BOOKING"]);
    expect(open[0]).toMatchObject({ subjectKey: `rule:${ruleId}`, subjectLabel: `Test 7b ${RUN}`, periodStart: day(800), periodEnd: day(830) });
    expect(open[0].changes.find((c) => c.label === "Prix")).toEqual({ label: "Prix", before: null, after: "+20 % sur le prix de base" });
    expect((await syncAlerts(sigma)).priceReminders).toBeGreaterThanOrEqual(2);

    await updatePriceRule(admin.actor, ruleId, ruleInput(home.id, 2500));
    open = await listPriceReminders(sigma, { listingId: home.id });
    expect(open).toHaveLength(2);
    expect(open[0].changes.find((c) => c.label === "Prix")).toEqual({ label: "Prix", before: null, after: "+25 % sur le prix de base" });

    const airbnb = open.find((r) => r.source === "AIRBNB")!;
    expect((await emailAct.markPriceReminderDoneAction(airbnb.id)).message).toBe("Marqué comme fait.");
    expect((await emailAct.markPriceReminderDoneAction(airbnb.id)).error).toMatch(/déjà marqué/);
    as(otherAdmin);
    expect((await emailAct.markPriceReminderDoneAction(open.find((r) => r.source === "BOOKING")!.id)).error).toBe("Rappel introuvable.");
    as(admin);
    expect((await listPriceReminders(sigma, { listingId: home.id })).map((r) => r.source)).toEqual(["BOOKING"]);
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: airbnb.id } })).action).toBe("price_reminder.done");

    // Deleted: Booking.com's open reminder (never reported) goes; Airbnb (reported) gets a new one.
    await deletePriceRule(admin.actor, ruleId);
    open = await listPriceReminders(sigma, { listingId: home.id });
    expect(open.map((r) => r.source)).toEqual(["AIRBNB"]);
    expect(open[0].changes.find((c) => c.label === "Prix")).toEqual({ label: "Prix", before: "+25 % sur le prix de base", after: null });
    await emailAct.markPriceReminderDoneAction(open[0].id);
  });

  it("a home's base price, minimum stay or cleaning fee; another field alone changes nothing", async () => {
    const home = homes[6];
    const listing = await db.listing.findUniqueOrThrow({ where: { id: home.id }, include: { amenities: true } });
    const values = (o: Record<string, string>) => {
      // The form takes 8 decimals of coordinates (the seed has more; afterAll puts them back).
      const coords = { lat: listing.lat.toFixed(8).replace(".", ","), lng: listing.lng.toFixed(8).replace(".", ",") };
      const parsed = parseListingForm({ ...listingToFormValues({ ...listing, amenityIds: listing.amenities.map((a) => a.amenityId) }), ...coords, ...o });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.fieldErrors));
      return parsed.input;
    };
    await updateAdminListing(sigma, home.id, values({ title: `${listing.title}` }));
    expect(await listPriceReminders(sigma, { listingId: home.id })).toEqual([]);
    await updateAdminListing(sigma, home.id, values({ price: String(Math.round(listing.priceCents / 100) + 100), minNights: String(listing.minNights + 1) }));
    const open = await listPriceReminders(sigma, { listingId: home.id });
    expect(open.map((r) => r.source).sort()).toEqual(["AIRBNB", "BOOKING"]);
    expect(open[0].changes.map((c) => c.label)).toEqual(["Prix de base par nuit", "Séjour minimum"]);
    // Back to the platform's values before anyone reported it: nothing left to report.
    await updateAdminListing(sigma, home.id, values({}));
    expect(await listPriceReminders(sigma, { listingId: home.id })).toEqual([]);
  });
});

// ---------- Connection guide ----------

describe("connection guide", () => {
  it("ticks by hand (audited), the platform's read of the export link seen by Sigma", async () => {
    const home = homes[7];
    as(admin);
    expect((await channelAct.setSetupTickAction(home.id, "BOOKING", "rulesSet", true)).message).toBe("Étape cochée.");
    expect((await channelAct.setSetupTickAction(home.id, "BOOKING", "importSet", true)).error).toBe("Étape inconnue.");
    let feed = (await listingChannels(sigma, home.id, ORIGIN))!.feeds.find((f) => f.source === "BOOKING")!;
    expect(feed.checklist.map((c) => [c.key, c.done])).toEqual([
      ["importSet", false],
      ["exportPasted", false],
      ["rulesSet", true],
      ["testDone", false],
    ]);
    expect(feed.guide.exportSteps.length).toBeGreaterThan(0);
    const file = feed.exportUrl!.split("/").pop()!;
    expect((await icalGet(new Request(`${ORIGIN}/ical/${file}`), { params: Promise.resolve({ file }) })).status).toBe(200);
    feed = (await listingChannels(sigma, home.id, ORIGIN))!.feeds.find((f) => f.source === "BOOKING")!;
    expect(feed.checklist.find((c) => c.key === "exportPasted")).toMatchObject({ done: true, how: "auto" });
    expect((await channelAct.setSetupTickAction(home.id, "BOOKING", "rulesSet", false)).message).toBe("Étape décochée.");
    const audit = await db.auditLog.findMany({ where: { targetId: home.id, action: "channel.setup_checked", createdAt: { gte: t0 } } });
    expect(audit).toHaveLength(2);
  });
});
