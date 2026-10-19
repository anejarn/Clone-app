import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Conciergerie (Lot 4b) through the real server actions and functions: partners and services (associés only, audited,
 * other organizations' rows « introuvables »), the agents' read-only catalogue without partner prices, the guest's
 * request from the welcome guide (valid, invalid, revoked or cancelled link; stay window and lead time; rate limits),
 * the price snapshot that later catalogue changes don't touch, the status flow and its database checks, sending to the
 * partner through lib/notifications, payment, the dashboard's margin, and the guest payload that never carries a partner
 * price, a margin or a partner's contact. Every row is on a home, partners and services this file creates, deleted at
 * the end; bookings from day 230.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/conciergerie/actions");
const reqAct = await import("@/app/admin/conciergerie/demandes/actions");
const { requestServiceAction } = await import("@/app/guide/[token]/actions");
const { GET: servicePhoto } = await import("@/app/guide/[token]/services/[serviceId]/route");
const { GET: media } = await import("@/app/media/[...key]/route");
const { createStaffEntry, cancelStaffBooking } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { issueGuideLink, revokeGuideLink } = await import("@/lib/server/guide/admin");
const { getGuestGuide, guideLookupLimiter } = await import("@/lib/server/guide/guest");
const { createGuestRequest, guestRequestClientLimiter, guestRequestStayLimiter, MAX_OPEN_REQUESTS } = await import("@/lib/server/concierge/guest");
const { listServices, getService } = await import("@/lib/server/concierge/admin");
const { conciergeStats, getRequest, listRequests } = await import("@/lib/server/concierge/requests");
const { localInstant } = await import("@/lib/operations/schedule");
const { setNotifier } = await import("@/lib/notifications");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;
type Notification = import("@/lib/notifications").Notification;

const sigma = await sigmaOrgId();
const TAG = `C${Date.now()}`;
const TZ = "Africa/Casablanca";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PARTNER_PHONE = "+212 600 009 901";
const PARTNER_EMAIL = `partner-${TAG.toLowerCase()}@demo.sigma.test`;

interface Member {
  headers: Headers;
  actor: Authorized;
  id: string;
}

let storeDir: string;
let admin: Member;
let agent: Member;
let otherAdmin: Member;
let otherOrg: string;
let home: string;
let partnerId: string;
let hammamId: string;
let carId: string;
let quoteId: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];
const ownListings: string[] = [];
const sent: Notification[] = [];

const as = (h: Headers) => {
  ctx.headers = h;
};
function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** The instant at hh:mm Marrakech time on day(n). */
const marrakech = (n: number, hh: number, mm = 0) => localInstant(utc(day(n)), hh * 60 + mm, TZ);

async function member(role: Role, organizationId: string | null, twoFactor = true): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TAG}` });
  createdUsers.push(m.user.id);
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, owner: string) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "medina" } });
  const l = await db.listing.create({
    data: { title: `Riad conciergerie ${TAG}`, description: "x", organizationId, placeId: place.id, ownerId: owner, address: `Derb ${TAG}`, lat: 31.63, lng: -7.99, maxGuests: 4, minNights: 1, priceCents: 90_000 },
  });
  ownListings.push(l.id);
  return l.id;
}

async function stay(from: number, to: number) {
  const entry = parseEntryForm("directe", { listingId: home, checkIn: day(from), checkOut: day(to), adults: "2", children: "0", note: "", guestName: "Lucía Fernández", guestPhone: "+34 600 000 001", channel: "WHATSAPP", nightly: "", cleaning: "" });
  if (!entry.ok) throw new Error(JSON.stringify(entry.fieldErrors));
  return (await createStaffEntry(admin.actor, entry.entry)).id;
}

async function linkFor(bookingId: string) {
  return (await issueGuideLink(admin.actor, bookingId)).token;
}

const serviceValues = (over: Record<string, string> = {}) => ({
  partnerId,
  category: "HAMMAM",
  pricingModel: "PER_PERSON",
  title_fr: `Hammam ${TAG}`,
  title_es: `Hammam ES ${TAG}`,
  description_fr: "Gommage et thé",
  salePrice: "300",
  partnerPrice: "220",
  leadTimeHours: "4",
  position: "0",
  active: "on",
  option0_label_fr: "Massage 30 min",
  option0_label_en: "30-min massage",
  option0_sale: "250",
  option0_partner: "180",
  option0_perUnit: "on",
  ...over,
});

/** A guest request through the real guide action; returns its state. */
async function ask(token: string, values: Record<string, string | string[]>) {
  as(new Headers());
  return requestServiceAction(token, {}, form({ lang: "fr", time: "10:00", persons: "2", quantity: "1", phone: "+34 600 000 001", ...values }));
}

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-concierge-"));
  setFileStorage(new LocalStorage(storeDir));
  setNotifier({ name: "test", send: async (n) => (sent.push(n), { delivered: false, channel: null }) });
  const owner = await db.user.create({ data: { name: `Owner ${TAG}`, email: `owner-${TAG.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  createdUsers.push(owner.id);
  admin = await member("ADMIN", sigma);
  agent = await member("AGENT", sigma);
  home = await makeHome(sigma, owner.id);
  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `cc-${TAG.toLowerCase()}` } })).id;
  otherAdmin = await member("ADMIN", otherOrg);
  refused.set("anonymous", new Headers());
  refused.set("guest", (await member("GUEST", null, false)).headers);
  refused.set("owner", (await member("OWNER", sigma, false)).headers);
  refused.set("agent", agent.headers);
  refused.set("admin without 2FA", (await member("ADMIN", sigma, false)).headers);

  as(admin.headers);
  expect(await act.createPartnerAction({}, form({ name: `Hammam partenaire ${TAG}`, type: "HAMMAM", whatsapp: PARTNER_PHONE, email: PARTNER_EMAIL, preferredChannel: "WHATSAPP", notes: "secret-note" }))).toEqual({ message: "Partenaire ajouté." });
  partnerId = (await db.partner.findFirstOrThrow({ where: { organizationId: sigma, name: `Hammam partenaire ${TAG}` } })).id;
  await expect(act.createServiceAction({}, form(serviceValues()))).rejects.toThrow(/NEXT_REDIRECT/);
  hammamId = (await db.service.findFirstOrThrow({ where: { partnerId, category: "HAMMAM" } })).id;
  await expect(act.createServiceAction({}, form(serviceValues({ category: "CAR", pricingModel: "PER_DAY", title_fr: `Voiture ${TAG}`, salePrice: "350", partnerPrice: "280", leadTimeHours: "24", option0_label_fr: "Livraison", option0_sale: "100", option0_partner: "60", option0_perUnit: "" })))).rejects.toThrow(/NEXT_REDIRECT/);
  carId = (await db.service.findFirstOrThrow({ where: { partnerId, category: "CAR" } })).id;
  await expect(act.createServiceAction({}, form(serviceValues({ category: "GROCERIES", pricingModel: "ON_QUOTE", title_fr: `Courses ${TAG}`, salePrice: "", partnerPrice: "", option0_label_fr: "" })))).rejects.toThrow(/NEXT_REDIRECT/);
  quoteId = (await db.service.findFirstOrThrow({ where: { partnerId, category: "GROCERIES" } })).id;
});

beforeEach(() => {
  as(admin.headers);
  sent.length = 0;
  guideLookupLimiter.reset();
  guestRequestClientLimiter.reset();
  guestRequestStayLimiter.reset();
});

afterAll(async () => {
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  const requestIds = (await db.serviceRequest.findMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { partnerId }] }, select: { id: true } })).map((r) => r.id);
  const serviceIds = (await db.service.findMany({ where: { partnerId }, select: { id: true } })).map((s) => s.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...ownListings, ...bookingIds, ...requestIds, ...serviceIds, partnerId, ...createdUsers] } }, { organizationId: otherOrg }] } });
  await db.serviceRequest.deleteMany({ where: { id: { in: requestIds } } });
  await db.service.deleteMany({ where: { OR: [{ id: { in: serviceIds } }, { organizationId: otherOrg }] } });
  await db.partner.deleteMany({ where: { OR: [{ id: partnerId }, { organizationId: otherOrg }] } });
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
  setFileStorage(undefined);
  setNotifier(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("catalogue: who may change what", () => {
  it("refuses anonymous visitors, guests, owners, agents and an associé without double authentification", async () => {
    const request = await db.serviceRequest.findFirst({ where: { organizationId: sigma }, select: { id: true } });
    for (const [who, headers] of refused) {
      as(headers);
      const results = [
        await act.createPartnerAction({}, form({ name: "Pirate", type: "CAR", whatsapp: "+212600000999", preferredChannel: "WHATSAPP" })),
        await act.updatePartnerAction(partnerId, {}, form({ name: "Pirate", type: "CAR", whatsapp: "+212600000999", preferredChannel: "WHATSAPP" })),
        await act.deletePartnerAction(partnerId),
        await act.createServiceAction({}, form(serviceValues({ title_fr: "Pirate" }))),
        await act.updateServiceAction(hammamId, {}, form(serviceValues({ salePrice: "1" , partnerPrice: "0" }))),
        await act.deleteServiceAction(hammamId),
        await act.setServicePhotoAction(hammamId, {}, form({})),
        await act.removeServicePhotoAction(hammamId),
        await reqAct.markSentAction(request?.id ?? "x", "WHATSAPP"),
        await reqAct.setRequestStatusAction(request?.id ?? "x", "CANCELLED"),
        await reqAct.setFinalPriceAction(request?.id ?? "x", {}, form({ saleTotal: "1", partnerTotal: "0" })),
        await reqAct.recordPaymentAction(request?.id ?? "x", {}, form({ method: "CASH" })),
        await reqAct.cancelPaymentAction(request?.id ?? "x"),
        await reqAct.setInternalNoteAction(request?.id ?? "x", {}, form({ internalNote: "x" })),
      ];
      for (const r of results) expect(r.error, who).toMatch(/Connectez-vous|Accès refusé|double authentification/);
    }
    expect(await db.partner.count({ where: { name: "Pirate" } })).toBe(0);
    expect((await db.service.findUniqueOrThrow({ where: { id: hammamId } })).salePriceCents).toBe(30_000);
  });

  it("another organization's associé finds none of Sigma's partners, services or requests", async () => {
    as(otherAdmin.headers);
    expect(await act.updatePartnerAction(partnerId, {}, form({ name: "X", type: "CAR", whatsapp: "+212600000999", preferredChannel: "WHATSAPP", active: "on" }))).toMatchObject({ error: "Partenaire introuvable." });
    expect(await act.deletePartnerAction(partnerId)).toEqual({ error: "Partenaire introuvable." });
    expect(await act.updateServiceAction(hammamId, {}, form(serviceValues()))).toMatchObject({ error: "Service introuvable." });
    expect(await act.deleteServiceAction(hammamId)).toEqual({ error: "Service introuvable." });
    expect(await act.setServicePhotoAction(hammamId, {}, form({ photo: new File([PNG], "p.png") as unknown as string }))).toEqual({ error: "Service introuvable." });
    // A service of Sigma given to another organization's partner, or the reverse, is refused.
    expect(await act.createServiceAction({}, form(serviceValues({ title_fr: "Intrus" })))).toMatchObject({ error: expect.stringMatching(/Partenaire/) });
    expect(await getService(otherAdmin.actor, hammamId)).toBeNull();
    expect((await listServices(otherAdmin.actor)).map((s) => s.id)).not.toContain(hammamId);
    const req = await db.serviceRequest.findFirstOrThrow({ where: { organizationId: sigma } });
    expect(await getRequest(otherAdmin.actor, req.id)).toBeNull();
    expect((await listRequests(otherAdmin.actor, { status: "ALL" })).items).toEqual([]);
    for (const r of [await reqAct.markSentAction(req.id, "WHATSAPP"), await reqAct.setRequestStatusAction(req.id, "CANCELLED"), await reqAct.recordPaymentAction(req.id, {}, form({ method: "CASH" }))]) {
      expect(r).toEqual({ error: "Demande introuvable." });
    }
    expect((await conciergeStats(otherOrg)).newRequests).toBe(0);
    // And the database itself refuses a service on another organization's partner (composite foreign key).
    await expect(db.service.create({ data: { organizationId: otherOrg, partnerId, category: "CAR", title: { fr: "x" }, pricingModel: "ON_QUOTE" } })).rejects.toThrow();
  });

  it("agents read the active catalogue with sale prices only: no partner price, margin or partner", async () => {
    await db.service.update({ where: { id: quoteId }, data: { active: false } });
    try {
      const mine = (await listServices(agent.actor, { includeInactive: true })).filter((s) => s.id === hammamId || s.id === quoteId);
      expect(mine.map((s) => s.id)).toEqual([hammamId]);
      expect(mine[0]).toMatchObject({ salePriceCents: 30_000, partnerPriceCents: null, marginCents: null, marginBps: null, partner: null });
      expect(mine[0].options.every((o) => o.partnerCents === 0)).toBe(true);
      expect(JSON.stringify(mine)).not.toContain(PARTNER_PHONE);
      const full = (await listServices(admin.actor, { includeInactive: true })).find((s) => s.id === hammamId)!;
      expect(full).toMatchObject({ partnerPriceCents: 22_000, marginCents: 8_000, marginBps: 2_667 });
    } finally {
      await db.service.update({ where: { id: quoteId }, data: { active: true } });
    }
  });

  it("validates, audits every change (prices, never the partner's contacts) and refuses a negative margin in the database too", async () => {
    expect(await act.updateServiceAction(hammamId, {}, form(serviceValues({ partnerPrice: "301" })))).toMatchObject({ fieldErrors: { partnerPrice: expect.stringContaining("marge négative") } });
    await expect(db.service.update({ where: { id: hammamId }, data: { partnerPriceCents: 40_000 } })).rejects.toThrow(/services_price_check/);
    await expect(db.service.update({ where: { id: hammamId }, data: { salePriceCents: null } })).rejects.toThrow(/services_price_check/);
    await expect(db.service.update({ where: { id: hammamId }, data: { title: { es: "sin francés" } } })).rejects.toThrow(/services_fields_check/);
    await expect(db.partner.update({ where: { id: partnerId }, data: { whatsapp: null, email: null } })).rejects.toThrow(/partners_contact_check/);
    const audits = await db.auditLog.findMany({ where: { targetId: { in: [partnerId, hammamId] } } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["partner.created", "service.created"]));
    expect(audits.find((a) => a.action === "service.created" && a.targetId === hammamId)?.details).toMatchObject({ salePriceCents: 30_000, partnerPriceCents: 22_000, pricingModel: "PER_PERSON" });
    expect(JSON.stringify(audits)).not.toContain(PARTNER_PHONE);
    expect(JSON.stringify(audits)).not.toContain("secret-note");
  });

  it("a partner with services can't be deleted; a service photo is for staff by /media and for the link's holder", async () => {
    expect(await act.deletePartnerAction(partnerId)).toEqual({ error: "Ce partenaire a des services ou des demandes : désactivez-le plutôt." });
    expect(await act.setServicePhotoAction(hammamId, {}, form({ photo: new File([PNG], "p.png", { type: "image/png" }) as unknown as string }))).toEqual({ message: "Photo enregistrée." });
    const key = (await db.service.findUniqueOrThrow({ where: { id: hammamId } })).photoKey!;
    expect(key).toMatch(new RegExp(`^services/${sigma}/${hammamId}/`));
    const mediaGet = (headers: Headers) => media(new Request(`http://localhost:3100/media/${key}`, { headers }), { params: Promise.resolve({ key: key.split("/") }) });
    expect((await mediaGet(admin.headers)).status).toBe(200);
    expect((await mediaGet(agent.headers)).status).toBe(200);
    expect((await mediaGet(new Headers())).status).toBe(404);
    expect((await mediaGet(otherAdmin.headers)).status).toBe(404);
    const token = await linkFor(await stay(230, 232));
    const get = (t: string, id = hammamId) => servicePhoto(new Request(`http://localhost:3100/guide/${t}/services/${id}`), { params: Promise.resolve({ token: t, serviceId: id }) });
    const ok = await get(token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect((await get("x".repeat(43))).status).toBe(404);
    expect((await get(token, carId)).status).toBe(404); // no photo
  });
});

describe("a guest's request from the welcome guide", () => {
  it("creates a request with the price of the moment, which later catalogue changes don't alter", async () => {
    const booking = await stay(234, 237);
    const token = await linkFor(booking);
    const r = await ask(token, { serviceId: hammamId, date: day(235), time: "18:00", persons: "3", options: ["massagexx"] });
    expect(r).toMatchObject({ error: "Vérifiez les champs signalés.", fieldErrors: { options: expect.any(String) } });
    const opt = (await getService(admin.actor, hammamId))!.options[0].id;
    const ok = await ask(token, { serviceId: hammamId, date: day(235), time: "18:00", persons: "3", options: [opt], note: "Allergie" });
    expect(ok).toMatchObject({ ok: true, message: expect.stringMatching(/^Demande envoyée.*Réf\. [A-Z0-9]{6}$/) });
    const req = await db.serviceRequest.findFirstOrThrow({ where: { bookingId: booking } });
    expect(req).toMatchObject({
      organizationId: sigma,
      partnerId,
      status: "NEW",
      quantity: 3,
      persons: 3,
      pricingModel: "PER_PERSON",
      unitSaleCents: 30_000,
      unitPartnerCents: 22_000,
      saleTotalCents: 3 * 30_000 + 3 * 25_000,
      partnerTotalCents: 3 * 22_000 + 3 * 18_000,
      marginCents: 3 * 8_000 + 3 * 7_000,
      guestNote: "Allergie",
      guestLocale: "fr",
      startMinutes: 18 * 60,
    });
    expect(req.scheduledAt).toEqual(marrakech(235, 18));
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: req.id, action: "service_request.created" } });
    expect(log).toMatchObject({ actorId: null, organizationId: sigma, details: { bookingId: booking, saleTotalCents: 165_000, marginCents: 45_000 } });
    expect(JSON.stringify(log.details)).not.toContain("+34");
    expect(JSON.stringify(log.details)).not.toContain("Allergie");

    // The catalogue changes: the request keeps its price.
    as(admin.headers);
    expect(await act.updateServiceAction(hammamId, {}, form(serviceValues({ salePrice: "500", partnerPrice: "300", option0_id: opt, option0_sale: "400", option0_partner: "100" })))).toEqual({ message: "Service enregistré." });
    const again = await db.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(again).toMatchObject({ unitSaleCents: 30_000, saleTotalCents: 165_000, partnerTotalCents: 120_000, marginCents: 45_000 });
    expect(again.options).toEqual([expect.objectContaining({ id: opt, saleCents: 25_000, partnerCents: 18_000 })]);
    const guide = (await getGuestGuide(token))!;
    expect(guide.services.requests).toEqual([expect.objectContaining({ id: req.id, status: "NEW", totalCents: 165_000, paid: false, persons: 3, date: utc(day(235)).toISOString().slice(0, 10).split("-").reverse().join("/") })]);
    expect(await act.updateServiceAction(hammamId, {}, form(serviceValues({ option0_id: opt })))).toEqual({ message: "Service enregistré." });
  });

  it("checks the stay window and the lead time in Marrakech time", async () => {
    const booking = await stay(238, 240);
    const token = await linkFor(booking);
    const values = (date: string, time: string) => ({ serviceId: hammamId, date, time, persons: "1", quantity: "1", phone: "+34 600 000 001" });
    // Before arrival and after departure: refused.
    expect(await createGuestRequest(token, values(day(237), "10:00"), [], { locale: "fr" })).toEqual({ ok: false, code: "form", errors: { outsideStay: true }, leadTimeHours: 4 });
    expect(await createGuestRequest(token, values(day(241), "10:00"), [], { locale: "fr" })).toMatchObject({ ok: false, errors: { outsideStay: true } });
    // Departure morning: fine.
    expect(await createGuestRequest(token, values(day(240), "09:00"), [], { locale: "fr" })).toMatchObject({ ok: true });
    // 4 h of notice: at 14:00 local for 18:00 is just enough, at 14:01 too late.
    const now = marrakech(239, 14);
    expect(await createGuestRequest(token, values(day(239), "18:00"), [], { locale: "fr", now })).toMatchObject({ ok: true });
    expect(await createGuestRequest(token, values(day(239), "18:00"), [], { locale: "fr", now: new Date(now.getTime() + 60_000) })).toMatchObject({ ok: false, errors: { tooSoon: true } });
    expect(await createGuestRequest(token, values(day(239), "13:00"), [], { locale: "fr", now })).toMatchObject({ ok: false, errors: { past: true } });
    // The guest sees it in their language.
    const es = await ask(token, { ...values(day(237), "10:00"), lang: "es" });
    expect(es.fieldErrors?.date).toBe("Elija una fecha durante su estancia.");
  });

  it("refuses unknown, revoked and cancelled links, inactive or foreign services; the stay is over once checked out", async () => {
    expect(await createGuestRequest("x".repeat(43), { serviceId: hammamId, date: day(243), time: "10:00", phone: "+34600000001" }, [], { locale: "fr" })).toEqual({ ok: false, code: "unavailable" });
    const booking = await stay(242, 244);
    const token = await linkFor(booking);
    const v = { serviceId: hammamId, date: day(243), time: "10:00", persons: "1", phone: "+34 600 000 001" };
    // Another organization's service, an inactive one.
    const foreignPartner = await db.partner.create({ data: { organizationId: otherOrg, name: "Autre", type: "CAR", whatsapp: "+212600000998" } });
    const foreign = await db.service.create({ data: { organizationId: otherOrg, partnerId: foreignPartner.id, category: "CAR", title: { fr: "Autre" }, pricingModel: "PER_DAY", salePriceCents: 100, partnerPriceCents: 50 } });
    expect(await createGuestRequest(token, { ...v, serviceId: foreign.id }, [], { locale: "fr" })).toMatchObject({ ok: false, errors: { service: true } });
    await db.service.update({ where: { id: carId }, data: { active: false } });
    expect(await createGuestRequest(token, { ...v, serviceId: carId }, [], { locale: "fr" })).toMatchObject({ ok: false, errors: { service: true } });
    await db.service.update({ where: { id: carId }, data: { active: true } });
    // After check-out time on the departure day: no more requests (the link still opens the guide for 30 days).
    expect(await createGuestRequest(token, v, [], { locale: "fr", now: marrakech(244, 11) })).toEqual({ ok: false, code: "unavailable" });
    expect((await getGuestGuide(token, { now: marrakech(244, 11) }))!.services.open).toBe(false);
    expect((await getGuestGuide(token))!.services.open).toBe(true);

    await revokeGuideLink(admin.actor, booking);
    expect(await ask(token, v)).toMatchObject({ error: "Les demandes ne sont plus possibles depuis ce lien." });
    const cancelled = await stay(246, 248);
    const t2 = await linkFor(cancelled);
    await cancelStaffBooking(admin.actor, cancelled);
    expect(await createGuestRequest(t2, { ...v, date: day(247) }, [], { locale: "fr" })).toEqual({ ok: false, code: "unavailable" });
    expect(await db.serviceRequest.count({ where: { bookingId: { in: [booking, cancelled] } } })).toBe(0);
    // Owner blocks never have a request (trigger).
    const block = parseEntryForm("blocage", { listingId: home, checkIn: day(250), checkOut: day(252), note: "Propriétaire" });
    if (!block.ok) throw new Error(JSON.stringify(block.fieldErrors));
    const blockId = (await createStaffEntry(admin.actor, block.entry)).id;
    await expect(
      db.serviceRequest.create({
        data: { organizationId: sigma, bookingId: blockId, serviceId: hammamId, partnerId, serviceDate: utc(day(250)), startMinutes: 600, scheduledAt: marrakech(250, 10), quantity: 1, persons: 1, titleSnapshot: "x", category: "HAMMAM", pricingModel: "PER_PERSON", unitSaleCents: 1, unitPartnerCents: 0, saleTotalCents: 1, partnerTotalCents: 0, marginCents: 1, contactPhone: "+34600000001", guestLocale: "fr" },
      }),
    ).rejects.toThrow(/service_requests_booking_check/);
  });

  it("rate-limits submissions per client and caps a stay's open requests", async () => {
    const booking = await stay(254, 258);
    const token = await linkFor(booking);
    const v = { serviceId: hammamId, date: day(255), time: "10:00", persons: "1", phone: "+34 600 000 001" };
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await createGuestRequest(token, v, [], { locale: "fr", client: "203.0.113.7" }));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10]).toEqual({ ok: false, code: "rateLimited" });
    // Another client, same stay: the stay's open requests are capped.
    for (let i = 10; i < MAX_OPEN_REQUESTS; i++) expect((await createGuestRequest(token, v, [], { locale: "fr", client: `198.51.100.${i}` })).ok).toBe(true);
    expect(await createGuestRequest(token, v, [], { locale: "fr", client: "198.51.100.99" })).toEqual({ ok: false, code: "tooMany" });
    expect(await db.serviceRequest.count({ where: { bookingId: booking } })).toBe(MAX_OPEN_REQUESTS);
  });

  it("the guest's payload never holds a partner price, a margin, the partner or its contacts", async () => {
    const booking = await stay(260, 262);
    const token = await linkFor(booking);
    expect((await createGuestRequest(token, { serviceId: carId, date: day(261), time: "09:00", quantity: "2", persons: "2", phone: "+34 600 000 001" }, [], { locale: "en" })).ok).toBe(true);
    const guide = (await getGuestGuide(token, { lang: "es" }))!;
    const json = JSON.stringify(guide);
    const mine = guide.services.services.find((s) => s.id === hammamId)!;
    expect(mine).toEqual({
      id: hammamId,
      category: "HAMMAM",
      title: `Hammam ES ${TAG}`,
      description: "Gommage et thé",
      availability: null,
      pricingModel: "PER_PERSON",
      unitPriceCents: 30_000,
      options: [{ id: expect.any(String), label: "Massage 30 min", priceCents: 25_000, perUnit: true }],
      leadTimeHours: 4,
      hasPhoto: expect.any(Boolean),
    });
    expect(guide.services.services.find((s) => s.id === quoteId)).toMatchObject({ pricingModel: "ON_QUOTE", unitPriceCents: null });
    for (const secret of ["partnerPrice", "partnerCents", "partnerTotal", "margin", "unitPartner", PARTNER_PHONE, PARTNER_EMAIL, `Hammam partenaire ${TAG}`, "secret-note", "internalNote", "contactPhone", "+34 600 000 001", "22000", "28000"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(guide.services.requests).toEqual([expect.objectContaining({ status: "NEW", totalCents: 70_000, quantity: 2, paid: false })]);
  });
});

describe("the team follows a request", () => {
  it("sends it to the partner (wa.me / mailto and lib/notifications), confirms, records the cash payment, marks it done", async () => {
    const booking = await stay(264, 266);
    const token = await linkFor(booking);
    expect((await createGuestRequest(token, { serviceId: carId, date: day(264), time: "09:30", quantity: "2", persons: "2", phone: "+34 600 000 001", note: "Vol IB 1234" }, [], { locale: "es" })).ok).toBe(true);
    const id = (await db.serviceRequest.findFirstOrThrow({ where: { bookingId: booking } })).id;

    const detail = (await getRequest(admin.actor, id))!;
    expect(detail.send.whatsapp).toMatch(/^https:\/\/wa\.me\/212600009901\?text=/);
    expect(detail.send.mailto).toMatch(new RegExp(`^mailto:${PARTNER_EMAIL.replace(/[.]/g, "\\.")}\\?subject=`));
    expect(detail.send.text).toContain(`Bonjour Hammam partenaire ${TAG},`);
    expect(detail.send.text).toContain(`• Date : ${day(264).split("-").reverse().join("/")} à 09:30`);
    expect(detail.send.text).toContain("• Jours : 2");
    expect(detail.send.text).toContain("• Client : Lucía, +34 600 000 001");
    expect(detail.send.text).toContain("• Note du client : Vol IB 1234");
    // The partner's price (2 × 280), never the sale price or the margin.
    expect(detail.send.text).toContain("• Votre prix : 560 MAD");
    // The sale price (700 MAD) never appears (not "700" alone: the test tag, a timestamp, may contain those digits).
    expect(detail.send.text).not.toMatch(/\b700\b/);
    expect(detail.can).toEqual({ moves: ["CANCELLED", "REFUSED"], send: true, editPrice: true, recordPayment: false, cancelPayment: false });

    // Can't confirm before sending, can't pay before confirming.
    expect(await reqAct.setRequestStatusAction(id, "CONFIRMED")).toEqual({ error: "Cette demande ne peut pas passer à ce statut." });
    expect(await reqAct.recordPaymentAction(id, {}, form({ method: "CASH" }))).toEqual({ error: "Le paiement s'enregistre sur une demande confirmée ou réalisée." });

    expect(await reqAct.markSentAction(id, "WHATSAPP")).toEqual({ message: "Demande marquée comme transmise au partenaire." });
    expect(sent).toEqual([expect.objectContaining({ kind: "service_request.partner", to: expect.objectContaining({ phone: PARTNER_PHONE, email: null }), channels: ["whatsapp"], text: detail.send.text })]);
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "SENT_TO_PARTNER", sentVia: "WHATSAPP" });
    expect((await getGuestGuide(token))!.services.requests[0].status).toBe("SENT_TO_PARTNER");

    // A price agreed with the guest, before confirmation (audited).
    expect(await reqAct.setFinalPriceAction(id, {}, form({ saleTotal: "650", partnerTotal: "700" }))).toMatchObject({ fieldErrors: { partnerTotal: expect.any(String) } });
    expect(await reqAct.setFinalPriceAction(id, {}, form({ saleTotal: "650", partnerTotal: "540,50" }))).toEqual({ message: "Prix final enregistré." });
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ saleTotalCents: 65_000, partnerTotalCents: 54_050, marginCents: 10_950, priceAdjusted: true });
    const priceLog = await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "service_request.price_set" } });
    expect(priceLog.details).toEqual({ from: { saleTotalCents: 70_000, partnerTotalCents: 56_000, marginCents: 14_000 }, to: { saleTotalCents: 65_000, partnerTotalCents: 54_050, marginCents: 10_950 } });

    expect(await reqAct.setRequestStatusAction(id, "CONFIRMED")).toEqual({ message: "Statut enregistré." });
    expect(await reqAct.setFinalPriceAction(id, {}, form({ saleTotal: "1", partnerTotal: "0" }))).toEqual({ error: "Le prix ne se change plus une fois la demande confirmée.", values: { saleTotal: "1", partnerTotal: "0" } });
    expect(await reqAct.markSentAction(id, "EMAIL")).toMatchObject({ error: expect.stringContaining("plus à transmettre") });
    expect(await reqAct.recordPaymentAction(id, {}, form({ method: "BITCOIN" }))).toEqual({ error: "Moyen de paiement : choisissez dans la liste." });
    expect(await reqAct.recordPaymentAction(id, {}, form({ method: "CASH" }))).toEqual({ message: "Paiement enregistré." });
    expect(await reqAct.recordPaymentAction(id, {}, form({ method: "CASH" }))).toEqual({ error: "Le paiement de cette demande est déjà enregistré." });
    expect(await reqAct.setRequestStatusAction(id, "CANCELLED")).toEqual({ error: "Cette demande est payée : annulez d'abord l'enregistrement du paiement (remboursement)." });
    expect(await reqAct.setRequestStatusAction(id, "DONE")).toEqual({ message: "Statut enregistré." });
    expect(await reqAct.setRequestStatusAction(id, "CANCELLED")).toEqual({ error: "Cette demande ne peut pas passer à ce statut." });
    const done = await db.serviceRequest.findUniqueOrThrow({ where: { id } });
    expect(done).toMatchObject({ status: "DONE", paymentMethod: "CASH", paidById: admin.id });
    // Lot 6: done → its margin and the partner's cost are posted to the journal (sale = margin + partner cost).
    const posted = await db.financialEntry.findMany({ where: { serviceRequestId: id }, orderBy: { account: "asc" } });
    expect(posted.map((e) => [e.kind, e.account, e.amountCents, e.actorId])).toEqual([
      ["SERVICE", "SERVICE_MARGIN", done.marginCents, admin.id],
      ["SERVICE", "SERVICE_PARTNER_COST", done.partnerTotalCents, admin.id],
    ]);
    expect(done.confirmedAt!.getTime()).toBeGreaterThanOrEqual(done.sentAt!.getTime());
    expect(done.doneAt!.getTime()).toBeGreaterThanOrEqual(done.confirmedAt!.getTime());
    expect((await getGuestGuide(token))!.services.requests[0]).toMatchObject({ status: "DONE", totalCents: 65_000, paid: true });

    const actions = (await db.auditLog.findMany({ where: { targetId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((a) => a.action);
    expect(actions).toEqual(["service_request.created", "service_request.sent", "service_request.price_set", "service_request.status_changed", "service_request.payment_recorded", "service_request.status_changed"]);
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "service_request.payment_recorded" } })).details).toEqual({ method: "CASH", amountCents: 65_000 });
  });

  it("a quote: no price until the team sets one, then it can be confirmed; refusals and cancellations", async () => {
    const booking = await stay(268, 270);
    const token = await linkFor(booking);
    expect((await createGuestRequest(token, { serviceId: quoteId, date: day(269), time: "11:00", persons: "1", phone: "+34 600 000 001" }, [], { locale: "fr" })).ok).toBe(true);
    expect((await createGuestRequest(token, { serviceId: hammamId, date: day(269), time: "16:00", persons: "1", phone: "+34 600 000 001" }, [], { locale: "fr" })).ok).toBe(true);
    const [quote, hammam] = await db.serviceRequest.findMany({ where: { bookingId: booking }, orderBy: { scheduledAt: "asc" } });
    expect(quote).toMatchObject({ pricingModel: "ON_QUOTE", saleTotalCents: null, marginCents: null });
    expect((await getGuestGuide(token))!.services.requests[0]).toMatchObject({ totalCents: null });
    expect(await reqAct.markSentAction(quote.id, "EMAIL")).toMatchObject({ message: expect.any(String) });
    expect(sent[0]).toMatchObject({ to: { email: PARTNER_EMAIL, phone: null }, channels: ["email"] });
    expect(sent[0].text).toContain("• Prix : à nous indiquer (devis)");
    expect(await reqAct.setRequestStatusAction(quote.id, "CONFIRMED")).toEqual({ error: "Fixez d'abord le prix final (devis) avant de confirmer." });
    // Sent again (no answer yet).
    expect(await reqAct.markSentAction(quote.id, "WHATSAPP")).toMatchObject({ message: expect.any(String) });
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: quote.id, action: "service_request.sent" }, orderBy: { createdAt: "desc" } })).details).toMatchObject({ via: "WHATSAPP", again: true });
    expect(await reqAct.setFinalPriceAction(quote.id, {}, form({ saleTotal: "400", partnerTotal: "320" }))).toEqual({ message: "Prix final enregistré." });
    expect(await reqAct.setRequestStatusAction(quote.id, "CONFIRMED")).toEqual({ message: "Statut enregistré." });
    expect(await reqAct.setRequestStatusAction(hammam.id, "REFUSED")).toEqual({ message: "Statut enregistré." });
    expect(await reqAct.setRequestStatusAction(hammam.id, "CONFIRMED")).toEqual({ error: "Cette demande ne peut pas passer à ce statut." });
    expect(await reqAct.setRequestStatusAction(quote.id, "CANCELLED")).toEqual({ message: "Statut enregistré." });
    expect((await getGuestGuide(token))!.services.requests.map((r) => r.status)).toEqual(["CANCELLED", "REFUSED"]);
  });

  it("the database keeps status timestamps, prices and payment consistent", async () => {
    const r = await db.serviceRequest.findFirstOrThrow({ where: { partnerId, status: "NEW" } });
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { status: "CONFIRMED" } })).rejects.toThrow(/service_requests_status_check/);
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { status: "SENT_TO_PARTNER", sentAt: new Date() } })).rejects.toThrow(/service_requests_status_check/);
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { status: "SENT_TO_PARTNER", sentAt: new Date(), sentVia: "EMAIL", confirmedAt: new Date() } })).rejects.toThrow(/service_requests_status_check/);
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { marginCents: 1 } })).rejects.toThrow(/service_requests_price_check/);
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { partnerTotalCents: (r.saleTotalCents ?? 0) + 1, marginCents: -1 } })).rejects.toThrow(/service_requests_price_check/);
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { paidAt: new Date(), paymentMethod: "CASH" } })).rejects.toThrow(/service_requests_payment_check/);
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { quantity: 51 } })).rejects.toThrow(/service_requests_fields_check/);
    const sentAt = new Date();
    await expect(db.serviceRequest.update({ where: { id: r.id }, data: { status: "CONFIRMED", sentAt, sentVia: "EMAIL", confirmedAt: new Date(sentAt.getTime() - 1000) } })).rejects.toThrow(/service_requests_status_check/);
  });

  it("dashboard: new requests and the month's margin of confirmed and done requests", async () => {
    const before = await conciergeStats(sigma);
    const booking = await stay(272, 274);
    const token = await linkFor(booking);
    expect((await createGuestRequest(token, { serviceId: hammamId, date: day(273), time: "15:00", persons: "2", phone: "+34 600 000 001" }, [], { locale: "fr" })).ok).toBe(true);
    const req = await db.serviceRequest.findFirstOrThrow({ where: { bookingId: booking } });
    expect((await conciergeStats(sigma)).newRequests).toBe(before.newRequests + 1);
    const monthOf = req.serviceDate;
    const inMonth = await conciergeStats(sigma, monthOf);
    await reqAct.markSentAction(req.id, "WHATSAPP");
    await reqAct.setRequestStatusAction(req.id, "CONFIRMED");
    const after = await conciergeStats(sigma, monthOf);
    expect(after.monthMarginCents).toBe(inMonth.monthMarginCents + 16_000);
    expect(after.monthRequests).toBe(inMonth.monthRequests + 1);
    expect((await conciergeStats(sigma)).newRequests).toBe(before.newRequests);
  });
});
