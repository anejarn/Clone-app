import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Welcome guide (Lot 4a) through the real server actions and functions: the guide of a home (texts, Wi-Fi, codes
 * encrypted at rest, photos, recommendations), who may change and reveal what (associés; agents only from their own
 * task of today or tomorrow; every reveal audited), the secret link of a stay (issued, regenerated, revoked; owner
 * blocks and cancelled stays have none), and the guest's guide: codes only between check-in and check-out (clock
 * injected), nothing internal in the payload, languages. Every row is on homes this file creates, deleted at the end.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/biens/guide-actions");
const linkAct = await import("@/app/admin/reservations/guide-actions");
const taskAct = await import("@/app/admin/mes-taches/actions");
const { GET: guidePhoto } = await import("@/app/guide/[token]/photos/[photoId]/route");
const { GET: media } = await import("@/app/media/[...key]/route");
const { createStaffEntry, cancelStaffBooking } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { getStaffGuideLink, issueGuideLink } = await import("@/lib/server/guide/admin");
const { getGuestGuide, guideLookupLimiter } = await import("@/lib/server/guide/guest");
const { ENVELOPE_RE } = await import("@/lib/secrets/access-codes");
const { hashGuideToken } = await import("@/lib/guide/token");
const { todayInTimeZone } = await import("@/lib/dates");
const { localInstant } = await import("@/lib/operations/schedule");
const { db } = await import("@/lib/server/db");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const sigma = await sigmaOrgId();
const TOKEN = `G${Date.now()}`;
const TZ = "Africa/Casablanca";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const DOOR = "8642-door";
const WIFI = "wifi-secret-pw";
const NOTE = `Note interne ${TOKEN}`;
const PHONE = "+212 6 11 22 33 44";

interface Member {
  headers: Headers;
  actor: Authorized;
  id: string;
}

let storeDir: string;
let admin: Member;
let agent: Member;
let agent2: Member;
let otherAdmin: Member;
let otherOrg: string;
let home: string;
let other: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];
const ownListings: string[] = [];

const as = (h: Headers) => {
  ctx.headers = h;
};
function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function member(role: Role, organizationId: string | null, twoFactor = true): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TOKEN}` });
  createdUsers.push(m.user.id);
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, owner: string, title: string) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "medina" } });
  const l = await db.listing.create({
    data: {
      title: `${title} ${TOKEN}`,
      description: "x",
      organizationId,
      placeId: place.id,
      ownerId: owner,
      address: `Derb ${TOKEN}`,
      lat: 31.63,
      lng: -7.99,
      maxGuests: 4,
      minNights: 1,
      priceCents: 90_000,
      houseRules: "Pas de fête\nPas de fumée",
    },
  });
  ownListings.push(l.id);
  return l.id;
}

/** A direct stay on `listingId` from day(from) to day(to), typed by the associé. */
async function stay(listingId: string, from: number, to: number, extra: Record<string, string> = {}) {
  const entry = parseEntryForm("directe", { listingId, checkIn: day(from), checkOut: day(to), adults: "2", children: "0", note: NOTE, guestName: "Lucía Fernández", guestPhone: PHONE, channel: "WHATSAPP", nightly: "", cleaning: "", ...extra });
  if (!entry.ok) throw new Error(JSON.stringify(entry.fieldErrors));
  return (await createStaffEntry(admin.actor, entry.entry)).id;
}

/** A link for the booking; returns the token. */
async function link(bookingId: string) {
  return (await issueGuideLink(admin.actor, bookingId)).token;
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** The instant at hh:mm Marrakech time on day(n). */
const marrakech = (n: number, hh: number, mm = 0) => localInstant(utc(day(n)), hh * 60 + mm, TZ);

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-guide-"));
  setFileStorage(new LocalStorage(storeDir));
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  createdUsers.push(owner.id);
  admin = await member("ADMIN", sigma);
  agent = await member("AGENT", sigma);
  agent2 = await member("AGENT", sigma);
  home = await makeHome(sigma, owner.id, "Riad guide");

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `gd-${TOKEN.toLowerCase()}` } })).id;
  const otherOwner = await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
  other = await makeHome(otherOrg, otherOwner.id, "Autre riad");
  otherAdmin = await member("ADMIN", otherOrg);

  refused.set("anonymous", new Headers());
  refused.set("guest", (await member("GUEST", null, false)).headers);
  refused.set("owner", (await member("OWNER", sigma, false)).headers);
  refused.set("admin without 2FA", (await member("ADMIN", sigma, false)).headers);

  // The home's guide, filled in by the associé.
  as(admin.headers);
  await act.saveGuideTextsAction(home, {}, form({ access_fr: "Boîte à clés à droite", access_es: "Caja de llaves a la derecha", directions_fr: "Taxi jusqu'à Bab Doukkala", rules_en: "No parties\nNo smoking", useOrgRecommendations: "on" }));
  await act.saveWifiAction(home, {}, form({ wifiName: "Riad-Guide", wifiPassword: WIFI }));
  await act.addCodeAction(home, {}, form({ kind: "DOOR", label: "Porte du derb", value: DOOR }));
  await act.addRecommendationAction(home, {}, form({ category: "CAFE", name: `Café ${TOKEN}`, description_fr: "Thé à la menthe", description_es: "Té a la menta", url: "https://example.org" }));
});

beforeEach(() => {
  as(admin.headers);
  guideLookupLimiter.reset();
});

afterAll(async () => {
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  const taskIds = (await db.task.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((t) => t.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...ownListings, ...bookingIds, ...taskIds, ...createdUsers] } }, { organizationId: otherOrg }] } });
  // Guides, codes, photos, recommendations and links go with the listings and bookings (cascade).
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.checklistTemplate.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("access to the back-office actions", () => {
  it("refuses anonymous visitors, guests, owners and an associé without double authentification", async () => {
    const booking = await stay(home, 210, 212);
    for (const [who, headers] of refused) {
      as(headers);
      const results = [
        await act.saveGuideTextsAction(home, {}, form({ access_fr: "pirate" })),
        await act.saveWifiAction(home, {}, form({ wifiName: "x", wifiPassword: "y" })),
        await act.addCodeAction(home, {}, form({ kind: "ALARM", value: "0000" })),
        await act.revealSecretsAction(home),
        await act.saveConciergeAction({}, form({ conciergePhone: "+212600000001" })),
        await linkAct.issueGuideLinkAction(booking),
        await linkAct.revokeGuideLinkAction(booking),
        await taskAct.revealTaskCodesAction("whatever"),
      ];
      for (const r of results) expect(r.error, who).toMatch(/Connectez-vous|Accès refusé|double authentification/);
      expect(results.some((r) => "secrets" in r)).toBe(false);
    }
    expect(await db.guideAccessCode.count({ where: { listingId: home, kind: "ALARM" } })).toBe(0);
    expect(await db.guideLink.count({ where: { bookingId: booking } })).toBe(0);
  });

  it("refuses agents on the guide and the links", async () => {
    const booking = await stay(home, 214, 216);
    as(agent.headers);
    expect(await act.revealSecretsAction(home)).toEqual({ error: "Accès refusé." });
    expect(await act.addCodeAction(home, {}, form({ kind: "ALARM", value: "0000" }))).toEqual({ error: "Accès refusé." });
    expect(await linkAct.issueGuideLinkAction(booking)).toEqual({ error: "Accès refusé." });
  });

  it("another organization's associé finds neither the home nor the booking", async () => {
    const booking = await stay(home, 218, 220);
    as(otherAdmin.headers);
    expect(await act.revealSecretsAction(home)).toEqual({ error: "Bien introuvable." });
    expect(await act.saveWifiAction(home, {}, form({ wifiName: "x", wifiPassword: "y" }))).toMatchObject({ error: "Bien introuvable." });
    expect(await act.addCodeAction(home, {}, form({ kind: "ALARM", value: "0000" }))).toMatchObject({ error: "Bien introuvable." });
    const code = await db.guideAccessCode.findFirstOrThrow({ where: { listingId: home } });
    expect(await act.deleteCodeAction(home, code.id)).toEqual({ error: "Bien introuvable." });
    expect(await act.deleteCodeAction(other, code.id)).toEqual({ error: "Code introuvable." });
    expect(await linkAct.issueGuideLinkAction(booking)).toEqual({ error: "Réservation introuvable." });
    expect(await getStaffGuideLink(otherAdmin.actor, booking)).toBeNull();
    const reco = await db.guideRecommendation.findFirstOrThrow({ where: { listingId: home } });
    expect(await act.deleteRecommendationAction(reco.id)).toEqual({ error: "Recommandation introuvable." });
    expect(await db.guideAccessCode.count({ where: { id: code.id } })).toBe(1);
  });
});

describe("the home's guide", () => {
  it("stores the codes and the Wi-Fi password only encrypted; the database refuses plain values", async () => {
    const [codes, guide] = await Promise.all([
      db.$queryRaw<{ valueEnc: string }[]>`SELECT "valueEnc" FROM "guide_access_codes" WHERE "listingId" = ${home}`,
      db.$queryRaw<{ wifiPasswordEnc: string; row: string }[]>`SELECT "wifiPasswordEnc", row_to_json(g)::text AS "row" FROM "listing_guides" g WHERE "listingId" = ${home}`,
    ]);
    expect(codes).toHaveLength(1);
    expect(codes[0].valueEnc).toMatch(ENVELOPE_RE);
    expect(codes[0].valueEnc).not.toContain(DOOR);
    expect(guide[0].wifiPasswordEnc).toMatch(ENVELOPE_RE);
    expect(guide[0].row).not.toContain(WIFI);
    await expect(db.guideAccessCode.create({ data: { organizationId: sigma, listingId: home, kind: "OTHER", valueEnc: "1234" } })).rejects.toThrow(/guide_access_codes_value_check/);
    await expect(db.listingGuide.update({ where: { listingId: home }, data: { wifiPasswordEnc: "plain" } })).rejects.toThrow(/listing_guides_secret_check/);
    // Audit entries never carry a secret.
    const audits = await db.auditLog.findMany({ where: { targetId: home } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["guide.updated", "guide.wifi_updated", "guide.code_added", "guide.recommendation_added"]));
    expect(JSON.stringify(audits)).not.toContain(DOOR);
    expect(JSON.stringify(audits)).not.toContain(WIFI);
  });

  it("an associé reveals the codes on request, and the reveal is audited", async () => {
    const before = await db.auditLog.count({ where: { targetId: home, action: "guide.secrets_revealed" } });
    const r = await act.revealSecretsAction(home);
    expect(r.secrets).toMatchObject({ wifiName: "Riad-Guide", wifiPassword: WIFI, codes: [{ kind: "DOOR", label: "Porte du derb", value: DOOR }] });
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: home, action: "guide.secrets_revealed" }, orderBy: { createdAt: "desc" } });
    expect(log).toMatchObject({ organizationId: sigma, actorId: admin.id, targetType: "listing", details: { via: "guide", codes: 1, wifi: true } });
    expect(await db.auditLog.count({ where: { targetId: home, action: "guide.secrets_revealed" } })).toBe(before + 1);
  });

  it("changes a code's value only when typed, keeps the Wi-Fi password when left empty, validates", async () => {
    const code = await db.guideAccessCode.findFirstOrThrow({ where: { listingId: home } });
    expect(await act.updateCodeAction(home, code.id, {}, form({ kind: "DOOR", label: "Porte principale", value: "" }))).toEqual({ message: "Code modifié." });
    expect((await act.revealSecretsAction(home)).secrets?.codes[0]).toMatchObject({ label: "Porte principale", value: DOOR });
    expect(await act.saveWifiAction(home, {}, form({ wifiName: "Riad-Guide", wifiPassword: "" }))).toEqual({ message: "Wi-Fi enregistré." });
    expect((await act.revealSecretsAction(home)).secrets?.wifiPassword).toBe(WIFI);
    const bad = await act.addCodeAction(home, {}, form({ kind: "SAFE", value: "secret-value" }));
    expect(bad).toMatchObject({ error: "Corrigez les champs signalés." });
    // A refused form never sends the typed secret back.
    expect(JSON.stringify(bad)).not.toContain("secret-value");
    expect(await act.saveGuideTextsAction(home, {}, form({ mapsUrl: "http://insecure" }))).toMatchObject({ fieldErrors: { mapsUrl: expect.any(String) } });
  });

  it("access photos: served to associés by /media and to the link's holder only", async () => {
    expect(await act.uploadGuidePhotoAction(home, (() => { const f = new FormData(); f.set("photo", new File([PNG], "p.png", { type: "image/png" })); f.set("caption", "La porte"); return f; })())).toEqual({ message: "Photo ajoutée." });
    const photo = await db.guidePhoto.findFirstOrThrow({ where: { listingId: home } });
    const mediaGet = (headers: Headers) => media(new Request(`http://localhost:3100/media/${photo.storageKey}`, { headers }), { params: Promise.resolve({ key: photo.storageKey.split("/") }) });
    expect((await mediaGet(admin.headers)).status).toBe(200);
    expect((await mediaGet(agent.headers)).status).toBe(404);
    expect((await mediaGet(new Headers())).status).toBe(404);
    expect((await mediaGet(otherAdmin.headers)).status).toBe(404);

    const token = await link(await stay(home, 222, 224));
    const get = (t: string, id = photo.id) => guidePhoto(new Request(`http://localhost:3100/guide/${t}/photos/${id}`), { params: Promise.resolve({ token: t, photoId: id }) });
    const ok = await get(token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect((await get("x".repeat(43))).status).toBe(404);
    expect((await get(token, "nope")).status).toBe(404);
  });
});

describe("agents and the codes of their tasks", () => {
  it("an agent sees the codes for their own task of today or tomorrow, audited; not a colleague's, not later, not cancelled", async () => {
    const today = todayInTimeZone(TZ);
    const mk = (assigneeId: string, offset: number, status: "TODO" | "CANCELLED" | "DONE" = "TODO") => {
      const d = new Date(today.getTime() + offset * 86_400_000);
      return db.task.create({
        data: {
          organizationId: sigma,
          listingId: home,
          type: "OTHER",
          title: "Accueil",
          status,
          scheduledDate: d,
          startsAt: localInstant(d, 600, TZ),
          endsAt: localInstant(d, 660, TZ),
          assigneeId,
          ...(status === "CANCELLED" && { cancelledAt: new Date() }),
          ...(status === "DONE" && { startedAt: new Date(), completedAt: new Date() }),
        },
      });
    };
    const mine = await mk(agent.id, 0);
    const tomorrow = await mk(agent.id, 1);
    const later = await mk(agent.id, 3);
    const colleague = await mk(agent2.id, 0);

    as(agent.headers);
    const r = await taskAct.revealTaskCodesAction(mine.id);
    expect(r.secrets?.codes[0].value).toBe(DOOR);
    expect(r.secrets?.wifiPassword).toBe(WIFI);
    expect((await taskAct.revealTaskCodesAction(tomorrow.id)).secrets).toBeDefined();
    for (const t of [later, colleague]) expect((await taskAct.revealTaskCodesAction(t.id)).error).toMatch(/Codes indisponibles/);
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: home, action: "guide.secrets_revealed", actorId: agent.id }, orderBy: { createdAt: "desc" } });
    expect(log.details).toMatchObject({ via: "task" });
    expect(await db.auditLog.count({ where: { targetId: home, action: "guide.secrets_revealed", actorId: agent.id } })).toBe(2);

    await db.task.update({ where: { id: mine.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    expect((await taskAct.revealTaskCodesAction(mine.id)).error).toMatch(/Codes indisponibles/);
    // An associé from any task of the organization; another organization's associé from none.
    as(admin.headers);
    expect((await taskAct.revealTaskCodesAction(later.id)).secrets).toBeDefined();
    as(otherAdmin.headers);
    expect((await taskAct.revealTaskCodesAction(later.id)).error).toMatch(/Codes indisponibles/);
  });
});

describe("guide links", () => {
  it("are issued, shown again to the associé, regenerated (old link dead) and revoked, all audited", async () => {
    const booking = await stay(home, 226, 228);
    expect(await getStaffGuideLink(admin.actor, booking)).toMatchObject({ status: "NONE", token: null, eligible: true });
    expect(await getStaffGuideLink(agent.actor, booking)).toBeNull();
    expect(await linkAct.issueGuideLinkAction(booking)).toEqual({ message: "Lien du guide créé." });
    const first = (await getStaffGuideLink(admin.actor, booking))!;
    expect(first.status).toBe("ACTIVE");
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db.guideLink.findUniqueOrThrow({ where: { bookingId: booking } });
    expect(row.tokenHash).toBe(hashGuideToken(first.token!));
    expect(row.tokenEnc).toMatch(ENVELOPE_RE);
    expect(row.tokenEnc).not.toContain(first.token);
    expect(await getGuestGuide(first.token)).not.toBeNull();

    expect(await linkAct.issueGuideLinkAction(booking)).toEqual({ message: "Nouveau lien créé : l'ancien ne fonctionne plus." });
    const second = (await getStaffGuideLink(admin.actor, booking))!.token!;
    expect(second).not.toBe(first.token);
    expect(await getGuestGuide(first.token)).toBeNull();
    expect(await getGuestGuide(second)).not.toBeNull();

    expect(await linkAct.revokeGuideLinkAction(booking)).toEqual({ message: "Lien révoqué : le guide n'est plus accessible." });
    expect(await getGuestGuide(second)).toBeNull();
    expect(await getStaffGuideLink(admin.actor, booking)).toMatchObject({ status: "REVOKED", token: null });
    expect(await linkAct.revokeGuideLinkAction(booking)).toEqual({ error: "Aucun lien actif à révoquer." });
    const actions = (await db.auditLog.findMany({ where: { targetId: booking, action: { startsWith: "guide." } }, orderBy: { createdAt: "asc" } })).map((a) => [a.action, a.details]);
    expect(actions).toEqual([
      ["guide.link_issued", { regenerated: false }],
      ["guide.link_issued", { regenerated: true }],
      ["guide.link_revoked", {}],
    ]);
  });

  it("owner blocks and cancelled stays have no guide", async () => {
    const block = parseEntryForm("blocage", { listingId: home, checkIn: day(230), checkOut: day(232), note: "Propriétaire" });
    if (!block.ok) throw new Error("block");
    const blockId = (await createStaffEntry(admin.actor, block.entry)).id;
    expect(await linkAct.issueGuideLinkAction(blockId)).toEqual({ error: "Un blocage propriétaire n'a pas de guide d'accueil." });
    await expect(db.guideLink.create({ data: { bookingId: blockId, organizationId: sigma, tokenHash: "a".repeat(64), tokenEnc: (await db.guideAccessCode.findFirstOrThrow({ where: { listingId: home } })).valueEnc } })).rejects.toThrow(/guide_links_booking_check/);

    const booking = await stay(home, 234, 236);
    const token = await link(booking);
    expect(await getGuestGuide(token)).not.toBeNull();
    await cancelStaffBooking(admin.actor, booking);
    expect(await getGuestGuide(token)).toBeNull();
    expect(await linkAct.issueGuideLinkAction(booking)).toEqual({ error: "Réservation annulée : pas de guide d'accueil." });
  });

  it("proxy.ts answers a real 404 for a link that opens nothing, and lets a working one through", async () => {
    const token = await link(await stay(home, 246, 248));
    const call = (t: string) => proxy(new NextRequest(`http://localhost:3100/guide/${t}`));
    const ok = await call(token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    const missing = await call("q".repeat(43));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toContain("no-store");
    expect(await missing.text()).toContain("Guía no encontrada");
  });

  it("refuses malformed and unknown tokens, and stops a client after 30 failed lookups", async () => {
    for (const t of [null, "", "abc", "x".repeat(43), "x".repeat(44), "../../etc/passwd"]) expect(await getGuestGuide(t)).toBeNull();
    const token = await link(await stay(home, 238, 240));
    const client = `203.0.113.${Date.now() % 200}`;
    for (let i = 0; i < 30; i++) expect(await getGuestGuide("y".repeat(43), { client })).toBeNull();
    // Over the limit: even a good token is refused for this client, not for others.
    expect(await getGuestGuide(token, { client })).toBeNull();
    expect(await getGuestGuide(token, { client: "198.51.100.1" })).not.toBeNull();
  });
});

describe("the guest's guide", () => {
  let booking: string;
  let token: string;
  beforeAll(async () => {
    as(admin.headers);
    booking = await stay(home, 242, 245);
    token = await link(booking);
  });

  it("shows the codes and the Wi-Fi password only from 15:00 on arrival day to 11:00 on departure day (Marrakech)", async () => {
    const at = async (now: Date) => (await getGuestGuide(token, { now }))!;
    const before = await at(new Date(marrakech(242, 15).getTime() - 60_000));
    expect(before.access.state).toBe("BEFORE");
    expect(before.codes).toBeNull();
    expect(before.wifi).toEqual({ name: "Riad-Guide", configured: true, password: null });
    expect(before.hasCodes).toBe(true);
    expect(before.access).toMatchObject({ opensDate: day(242).split("-").reverse().join("/"), opensTime: "15:00" });
    expect(JSON.stringify(before)).not.toContain(DOOR);
    expect(JSON.stringify(before)).not.toContain(WIFI);

    const during = await at(marrakech(242, 15));
    expect(during.access.state).toBe("OPEN");
    expect(during.codes).toEqual([{ kind: "DOOR", label: expect.any(String), value: DOOR }]);
    expect(during.wifi.password).toBe(WIFI);
    expect((await at(new Date(marrakech(245, 11).getTime() - 1))).codes).toHaveLength(1);

    const after = await at(marrakech(245, 11));
    expect(after.access.state).toBe("AFTER");
    expect(after.codes).toBeNull();
    expect(after.wifi.password).toBeNull();
    expect(JSON.stringify(after)).not.toContain(DOOR);
    // 30 days after the stay the link no longer opens anything.
    expect(await getGuestGuide(token, { now: new Date(marrakech(245, 11).getTime() + 31 * 86_400_000) })).toBeNull();
  });

  it("never carries amounts, notes, the guest's contact or the owner", async () => {
    const g = (await getGuestGuide(token, { now: marrakech(243, 12) }))!;
    const json = JSON.stringify(g);
    const b = await db.booking.findUniqueOrThrow({ where: { id: booking }, include: { listing: { include: { owner: true } } } });
    for (const secret of [NOTE, PHONE, String(b.totalCents), b.listing.owner.name, b.listing.owner.email, "totalCents", "nightlyCents", "note", "commission"]) {
      expect(json).not.toContain(secret);
    }
    expect(g.guestFirstName).toBe("Lucía");
    expect(g.listing).toMatchObject({ title: `Riad guide ${TOKEN}`, placeName: "Médina", address: `Derb ${TOKEN}` });
    expect(g.listing.mapsUrl).toBe("https://www.google.com/maps/search/?api=1&query=31.63,-7.99");
  });

  it("speaks the asked language, else the booking's, else the browser's; untranslated texts in French", async () => {
    const fr = (await getGuestGuide(token, { acceptLanguage: "fr-FR,fr;q=0.9" }))!;
    expect(fr.locale).toBe("fr");
    expect(fr.accessInstructions).toBe("Boîte à clés à droite");
    expect(fr.houseRules).toEqual(["Pas de fête", "Pas de fumée"]);
    const es = (await getGuestGuide(token, { lang: "es", acceptLanguage: "fr" }))!;
    expect(es.locale).toBe("es");
    expect(es.accessInstructions).toBe("Caja de llaves a la derecha");
    expect(es.directions).toBe("Taxi jusqu'à Bab Doukkala");
    expect(es.recommendations.find((r) => r.name === `Café ${TOKEN}`)?.description).toBe("Té a la menta");
    const en = (await getGuestGuide(token, { acceptLanguage: "en-GB,en;q=0.9" }))!;
    expect(en.houseRules).toEqual(["No parties", "No smoking"]);
    expect(en.accessInstructions).toBe("Boîte à clés à droite");

    as(admin.headers);
    expect(await linkAct.setGuestLocaleAction(booking, {}, form({ guestLocale: "en" }))).toEqual({ message: "Langue enregistrée." });
    expect((await getGuestGuide(token, { acceptLanguage: "es" }))!.locale).toBe("en");
    expect((await getGuestGuide(token, { lang: "es" }))!.locale).toBe("es");
    expect(await linkAct.setGuestLocaleAction(booking, {}, form({ guestLocale: "de" }))).toEqual({ error: "Langue inconnue." });
    await expect(db.booking.update({ where: { id: booking }, data: { guestLocale: "français" } })).rejects.toThrow(/bookings_guest_locale_check/);
  });

  it("lists the home's recommendations, then the organization's unless turned off, and the conciergerie's contact", async () => {
    const org = await db.organization.findUniqueOrThrow({ where: { id: sigma }, select: { conciergePhone: true, conciergeWhatsapp: true } });
    const orgRecos = await db.guideRecommendation.count({ where: { organizationId: sigma, listingId: null } });
    const g = (await getGuestGuide(token))!;
    expect(g.recommendations[0].name).toBe(`Café ${TOKEN}`);
    expect(g.recommendations).toHaveLength(1 + orgRecos);
    expect(g.concierge).toEqual({ phone: org.conciergePhone, whatsapp: org.conciergeWhatsapp });
    await act.saveGuideTextsAction(home, {}, form({ access_fr: "Boîte à clés à droite", access_es: "Caja de llaves a la derecha", directions_fr: "Taxi jusqu'à Bab Doukkala", rules_en: "No parties\nNo smoking" }));
    expect((await getGuestGuide(token))!.recommendations).toHaveLength(1);
  });
});
