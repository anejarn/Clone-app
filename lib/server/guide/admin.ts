import "server-only";
import { randomBytes } from "node:crypto";
import { todayInTimeZone } from "@/lib/dates";
import type { AccessCodeInput, ConciergeInput, GuideTextsInput, RecommendationInput, WifiInput } from "@/lib/guide/form";
import { GUIDE_LIMITS } from "@/lib/guide/form";
import { canRevealForTask } from "@/lib/guide/access";
import { generateGuideToken, hashGuideToken } from "@/lib/guide/token";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { GuideAccessCodeKind } from "@/lib/generated/prisma/enums";
import { isGuestLocale, type GuestLocale } from "@/lib/i18n/locales";
import { readLocalized } from "@/lib/i18n/localized";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { stayTimes } from "@/lib/operations/schedule";
import { decryptSecret, encryptSecret, SecretDecryptError, type SecretContext } from "@/lib/secrets/access-codes";
import { fileStorage } from "@/lib/storage";
import { checkPhoto, IMAGE_EXTENSION } from "@/lib/storage/images";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * The welcome guide in the back-office (Lot 4a): a home's guide (Biens → Guide d'accueil, ADMIN), the organization's
 * common settings (conciergerie contact, default recommendations), the secret link of each stay (Réservations,
 * ADMIN) and the access codes shown to the team. Every function takes the caller (from lib/server/authz.ts) and only
 * reads or writes the caller's organization: another organization's id is « introuvable », as an unknown one.
 *
 * Secrets (access codes, Wi-Fi password, link tokens) are encrypted before they reach the database
 * (lib/secrets/access-codes.ts) and never put in the audit trail. Who sees them in clear:
 * - the associés (ADMIN), on request, on the guide page: revealListingSecrets, audited « guide.secrets_revealed »;
 * - an agent (AGENT) only for a home where they have a task assigned to them today or tomorrow (Marrakech), not
 *   cancelled nor done, from that task's page: revealTaskSecrets, audited too. Never in « Ma journée » (nothing
 *   secret is kept on a phone);
 * - the guests, on their guide, between check-in and check-out (lib/server/guide/guest.ts).
 */

const listingNotFound = () => new AppError(404, "NOT_FOUND", "Bien introuvable.");
const bookingNotFound = () => new AppError(404, "NOT_FOUND", "Réservation introuvable.");

const codeContext = (organizationId: string, listingId: string): SecretContext => ({ organizationId, listingId, purpose: "access-code" });
const wifiContext = (organizationId: string, listingId: string): SecretContext => ({ organizationId, listingId, purpose: "wifi" });
export const tokenContext = (organizationId: string, bookingId: string): SecretContext => ({ organizationId, bookingId, purpose: "guide-token" });

async function requireHome(tx: Prisma.TransactionClient, organizationId: string, listingId: string, lock = false) {
  if (lock) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "listings" WHERE "id" = ${listingId} AND "organizationId" = ${organizationId} AND "category" = 'HOME' FOR UPDATE`;
    if (!rows[0]) throw listingNotFound();
    return;
  }
  const l = await tx.listing.findFirst({ where: { id: listingId, organizationId, category: "HOME" }, select: { id: true } });
  if (!l) throw listingNotFound();
}

// ---------- Reading (back-office) ----------

/** Everything the guide page shows, secrets excepted (only whether they are set). Null when not found. */
export async function getGuideEditor(organizationId: string, listingId: string) {
  const l = await db.listing.findFirst({
    where: { id: listingId, organizationId, category: "HOME" },
    select: {
      id: true,
      title: true,
      address: true,
      city: true,
      lat: true,
      lng: true,
      houseRules: true,
      checkInMinutes: true,
      checkOutMinutes: true,
      place: { select: { name: true } },
      organization: { select: { checkInMinutes: true, checkOutMinutes: true, conciergePhone: true, conciergeWhatsapp: true } },
      guide: true,
      guideAccessCodes: { select: { id: true, kind: true, label: true, updatedAt: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      guidePhotos: { select: { id: true, storageKey: true, caption: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      guideRecommendations: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!l) return null;
  const orgRecommendations = await db.guideRecommendation.count({ where: { organizationId, listingId: null } });
  const g = l.guide;
  return {
    id: l.id,
    title: l.title,
    address: l.address,
    city: l.city,
    placeName: l.place.name,
    lat: l.lat,
    lng: l.lng,
    houseRules: l.houseRules,
    times: stayTimes(l.organization, l),
    timesFromListing: l.checkInMinutes !== null || l.checkOutMinutes !== null,
    concierge: { phone: l.organization.conciergePhone, whatsapp: l.organization.conciergeWhatsapp },
    guide: {
      mapsUrl: g?.mapsUrl ?? null,
      directions: readLocalized(g?.directions),
      accessInstructions: readLocalized(g?.accessInstructions),
      houseRulesTranslations: readLocalized(g?.houseRulesTranslations),
      wifiName: g?.wifiName ?? null,
      hasWifiPassword: !!g?.wifiPasswordEnc,
      useOrgRecommendations: g?.useOrgRecommendations ?? true,
      updatedAt: g?.updatedAt ?? null,
    },
    codes: l.guideAccessCodes,
    photos: l.guidePhotos.map((p) => ({ id: p.id, caption: p.caption, url: fileStorage().url(p.storageKey) })),
    recommendations: l.guideRecommendations.map((r) => ({ ...r, description: readLocalized(r.description) })),
    orgRecommendations,
  };
}

export type GuideEditor = NonNullable<Awaited<ReturnType<typeof getGuideEditor>>>;

// ---------- Texts and Wi-Fi ----------

export async function saveGuideTexts(actor: Authorized, listingId: string, input: GuideTextsInput): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await requireHome(tx, organizationId, listingId);
    const data = {
      mapsUrl: input.mapsUrl,
      directions: input.directions,
      accessInstructions: input.accessInstructions,
      houseRulesTranslations: input.houseRulesTranslations,
      useOrgRecommendations: input.useOrgRecommendations,
      updatedById: actor.user.id,
    };
    await tx.listingGuide.upsert({ where: { listingId }, create: { listingId, organizationId, ...data }, update: data });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "guide.updated",
      targetType: "listing",
      targetId: listingId,
      details: {
        languages: {
          directions: Object.keys(input.directions),
          accessInstructions: Object.keys(input.accessInstructions),
          houseRules: ["fr", ...Object.keys(input.houseRulesTranslations)],
        },
        useOrgRecommendations: input.useOrgRecommendations,
      },
    });
  });
}

export async function saveWifi(actor: Authorized, listingId: string, input: WifiInput): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await requireHome(tx, organizationId, listingId);
    const data: Prisma.ListingGuideUncheckedUpdateInput = { wifiName: input.wifiName, updatedById: actor.user.id };
    if (input.wifiPassword === null) data.wifiPasswordEnc = null;
    else if (input.wifiPassword !== undefined) data.wifiPasswordEnc = encryptSecret(input.wifiPassword, wifiContext(organizationId, listingId));
    await tx.listingGuide.upsert({
      where: { listingId },
      create: { listingId, organizationId, wifiName: input.wifiName, wifiPasswordEnc: (data.wifiPasswordEnc as string | null | undefined) ?? null, updatedById: actor.user.id },
      update: data,
    });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "guide.wifi_updated",
      targetType: "listing",
      targetId: listingId,
      details: { password: input.wifiPassword === null ? "removed" : input.wifiPassword === undefined ? "unchanged" : "changed" },
    });
  });
}

// ---------- Access codes ----------

export async function addAccessCode(actor: Authorized, listingId: string, input: AccessCodeInput): Promise<{ id: string }> {
  const { organizationId } = actor;
  if (!input.value) throw new AppError(422, "INVALID_INPUT", "Code : champ obligatoire");
  return db.$transaction(async (tx) => {
    await requireHome(tx, organizationId, listingId, true);
    const count = await tx.guideAccessCode.count({ where: { listingId } });
    if (count >= GUIDE_LIMITS.codesPerListing) throw new AppError(422, "TOO_MANY_CODES", `${GUIDE_LIMITS.codesPerListing} codes au maximum par bien.`);
    const code = await tx.guideAccessCode.create({
      data: { organizationId, listingId, kind: input.kind, label: input.label, position: count, valueEnc: encryptSecret(input.value!, codeContext(organizationId, listingId)) },
      select: { id: true },
    });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "guide.code_added", targetType: "listing", targetId: listingId, details: { codeId: code.id, kind: input.kind } });
    return code;
  });
}

export async function updateAccessCode(actor: Authorized, listingId: string, codeId: string, input: AccessCodeInput): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await requireHome(tx, organizationId, listingId);
    const found = await tx.guideAccessCode.findFirst({ where: { id: codeId, listingId, organizationId }, select: { id: true } });
    if (!found) throw new AppError(404, "NOT_FOUND", "Code introuvable.");
    await tx.guideAccessCode.update({
      where: { id: codeId },
      data: { kind: input.kind, label: input.label, ...(input.value && { valueEnc: encryptSecret(input.value, codeContext(organizationId, listingId)) }) },
    });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "guide.code_updated",
      targetType: "listing",
      targetId: listingId,
      details: { codeId, kind: input.kind, valueChanged: !!input.value },
    });
  });
}

export async function deleteAccessCode(actor: Authorized, listingId: string, codeId: string): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await requireHome(tx, organizationId, listingId);
    const deleted = await tx.guideAccessCode.deleteMany({ where: { id: codeId, listingId, organizationId } });
    if (deleted.count === 0) throw new AppError(404, "NOT_FOUND", "Code introuvable.");
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "guide.code_deleted", targetType: "listing", targetId: listingId, details: { codeId } });
  });
}

export interface RevealedSecrets {
  listingId: string;
  listingTitle: string;
  wifiName: string | null;
  wifiPassword: string | null;
  codes: { id: string; kind: GuideAccessCodeKind; label: string; value: string | null }[];
}

/** Decrypts a home's secrets; a value that can't be read (tampered, unknown key) comes back null, and is logged. */
async function readSecrets(tx: Prisma.TransactionClient, organizationId: string, listingId: string): Promise<RevealedSecrets | null> {
  const l = await tx.listing.findFirst({
    where: { id: listingId, organizationId, category: "HOME" },
    select: {
      title: true,
      guide: { select: { wifiName: true, wifiPasswordEnc: true } },
      guideAccessCodes: { select: { id: true, kind: true, label: true, valueEnc: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!l) return null;
  const open = (envelope: string, ctx: SecretContext) => {
    try {
      return decryptSecret(envelope, ctx);
    } catch (e) {
      if (e instanceof SecretDecryptError) {
        console.error(`guide secret of listing ${listingId} unreadable: ${e.message}`);
        return null;
      }
      throw e;
    }
  };
  return {
    listingId,
    listingTitle: l.title,
    wifiName: l.guide?.wifiName ?? null,
    wifiPassword: l.guide?.wifiPasswordEnc ? open(l.guide.wifiPasswordEnc, wifiContext(organizationId, listingId)) : null,
    codes: l.guideAccessCodes.map((c) => ({ id: c.id, kind: c.kind, label: c.label, value: open(c.valueEnc, codeContext(organizationId, listingId)) })),
  };
}

/** An associé reveals a home's codes and Wi-Fi password on the guide page (ADMIN; audited). */
export async function revealListingSecrets(actor: Authorized, listingId: string): Promise<RevealedSecrets> {
  if (actor.user.role !== "ADMIN") throw new AppError(403, "FORBIDDEN", "Accès refusé.");
  return db.$transaction(async (tx) => {
    const s = await readSecrets(tx, actor.organizationId, listingId);
    if (!s) throw listingNotFound();
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "guide.secrets_revealed",
      targetType: "listing",
      targetId: listingId,
      details: { via: "guide", codes: s.codes.length, wifi: s.wifiPassword !== null },
    });
    return s;
  });
}

/** The codes of a task's home, from the task's page (rule: canRevealForTask; audited). « Tâche introuvable » otherwise. */
export async function revealTaskSecrets(actor: Authorized, taskId: string, today = todayInTimeZone(MARRAKECH_TIMEZONE)): Promise<RevealedSecrets> {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.organizationId },
      select: { id: true, listingId: true, assigneeId: true, scheduledDate: true, status: true },
    });
    if (!task || !canRevealForTask({ role: actor.user.role, userId: actor.user.id }, task, today)) {
      throw new AppError(404, "NOT_FOUND", "Codes indisponibles pour cette tâche (réservés aux tâches qui vous sont confiées aujourd'hui ou demain).");
    }
    const s = await readSecrets(tx, actor.organizationId, task.listingId);
    if (!s) throw listingNotFound();
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "guide.secrets_revealed",
      targetType: "listing",
      targetId: task.listingId,
      details: { via: "task", taskId: task.id, codes: s.codes.length, wifi: s.wifiPassword !== null },
    });
    return s;
  });
}

// ---------- Photos ----------

export async function addGuidePhoto(actor: Authorized, listingId: string, bytes: Uint8Array, caption: string): Promise<{ id: string }> {
  const { organizationId } = actor;
  const check = checkPhoto(bytes);
  if (!check.ok) throw new AppError(422, "INVALID_PHOTO", check.message);
  if (!(await db.listing.count({ where: { id: listingId, organizationId, category: "HOME" } }))) throw listingNotFound();
  const storage = fileStorage();
  const key = `guides/${organizationId}/${listingId}/${randomBytes(16).toString("hex")}.${IMAGE_EXTENSION[check.type]}`;
  await storage.put(key, bytes, check.type);
  try {
    return await db.$transaction(async (tx) => {
      await requireHome(tx, organizationId, listingId, true);
      const count = await tx.guidePhoto.count({ where: { listingId } });
      if (count >= GUIDE_LIMITS.photosPerListing) throw new AppError(422, "TOO_MANY_PHOTOS", `${GUIDE_LIMITS.photosPerListing} photos d'accès au maximum.`);
      const photo = await tx.guidePhoto.create({ data: { organizationId, listingId, storageKey: key, caption, position: count }, select: { id: true } });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "guide.photo_added", targetType: "listing", targetId: listingId, details: { photoId: photo.id } });
      return photo;
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

export async function deleteGuidePhoto(actor: Authorized, listingId: string, photoId: string): Promise<void> {
  const { organizationId } = actor;
  const removed = await db.$transaction(async (tx) => {
    await requireHome(tx, organizationId, listingId);
    const photo = await tx.guidePhoto.findFirst({ where: { id: photoId, listingId, organizationId }, select: { id: true, storageKey: true } });
    if (!photo) throw new AppError(404, "NOT_FOUND", "Photo introuvable.");
    await tx.guidePhoto.delete({ where: { id: photo.id } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "guide.photo_deleted", targetType: "listing", targetId: listingId, details: { photoId } });
    return photo;
  });
  await fileStorage().delete(removed.storageKey).catch((e) => console.error("guide photo file not deleted", e));
}

/** /media/guides/…: the organization of a guide photo (served to its associés only). */
export async function guidePhotoAccess(storageKey: string): Promise<{ organizationId: string } | null> {
  return db.guidePhoto.findUnique({ where: { storageKey }, select: { organizationId: true } });
}

// ---------- Recommendations ----------

/** listingId null = the organization's default recommendations. */
export async function addRecommendation(actor: Authorized, listingId: string | null, input: RecommendationInput): Promise<{ id: string }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    if (listingId) await requireHome(tx, organizationId, listingId, true);
    const count = await tx.guideRecommendation.count({ where: { organizationId, listingId } });
    if (count >= GUIDE_LIMITS.recosPerScope) throw new AppError(422, "TOO_MANY", `${GUIDE_LIMITS.recosPerScope} recommandations au maximum.`);
    const r = await tx.guideRecommendation.create({ data: { organizationId, listingId, ...input, position: count }, select: { id: true } });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "guide.recommendation_added",
      targetType: listingId ? "listing" : "organization",
      targetId: listingId ?? organizationId,
      details: { recommendationId: r.id, name: input.name },
    });
    return r;
  });
}

async function findRecommendation(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  const r = await tx.guideRecommendation.findFirst({ where: { id, organizationId }, select: { id: true, listingId: true } });
  if (!r) throw new AppError(404, "NOT_FOUND", "Recommandation introuvable.");
  return r;
}

export async function updateRecommendation(actor: Authorized, id: string, input: RecommendationInput): Promise<{ listingId: string | null }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const r = await findRecommendation(tx, organizationId, id);
    await tx.guideRecommendation.update({ where: { id }, data: input });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "guide.recommendation_updated",
      targetType: r.listingId ? "listing" : "organization",
      targetId: r.listingId ?? organizationId,
      details: { recommendationId: id, name: input.name },
    });
    return { listingId: r.listingId };
  });
}

export async function deleteRecommendation(actor: Authorized, id: string): Promise<{ listingId: string | null }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const r = await findRecommendation(tx, organizationId, id);
    await tx.guideRecommendation.delete({ where: { id } });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "guide.recommendation_deleted",
      targetType: r.listingId ? "listing" : "organization",
      targetId: r.listingId ?? organizationId,
      details: { recommendationId: id },
    });
    return { listingId: r.listingId };
  });
}

// ---------- Organization settings ----------

export async function getGuideSettings(organizationId: string) {
  const [org, recommendations] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, conciergePhone: true, conciergeWhatsapp: true, checkInMinutes: true, checkOutMinutes: true } }),
    db.guideRecommendation.findMany({ where: { organizationId, listingId: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  return { ...org, recommendations: recommendations.map((r) => ({ ...r, description: readLocalized(r.description) })) };
}

export async function saveConcierge(actor: Authorized, input: ConciergeInput): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: actor.organizationId }, data: input });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "organization.concierge_updated",
      targetType: "organization",
      targetId: actor.organizationId,
      details: { phone: input.conciergePhone, whatsapp: input.conciergeWhatsapp },
    });
  });
}

// ---------- Guide links (Réservations) ----------

export type GuideLinkStatus = "NONE" | "ACTIVE" | "REVOKED";

export interface StaffGuideLink {
  status: GuideLinkStatus;
  /** The token in clear, ACTIVE only (decrypted for the associé who looks at the booking). */
  token: string | null;
  createdAt: Date | null;
  revokedAt: Date | null;
  guestLocale: GuestLocale | null;
  /** Whether this booking can have a guide: a guest stay, confirmed. */
  eligible: boolean;
}

/** The booking's guide link, for an associé (ADMIN). Null when the booking isn't found. */
export async function getStaffGuideLink(actor: Authorized, bookingId: string): Promise<StaffGuideLink | null> {
  if (actor.user.role !== "ADMIN") return null;
  const b = await db.booking.findFirst({
    where: { id: bookingId, organizationId: actor.organizationId },
    select: { id: true, source: true, status: true, guestLocale: true, guideLink: true },
  });
  if (!b) return null;
  const link = b.guideLink;
  let token: string | null = null;
  if (link && !link.revokedAt) {
    try {
      token = decryptSecret(link.tokenEnc, tokenContext(actor.organizationId, b.id));
    } catch (e) {
      if (!(e instanceof SecretDecryptError)) throw e;
      console.error(`guide link of booking ${b.id} unreadable: ${e.message}`);
    }
  }
  return {
    status: !link ? "NONE" : link.revokedAt ? "REVOKED" : "ACTIVE",
    token,
    createdAt: link?.createdAt ?? null,
    revokedAt: link?.revokedAt ?? null,
    guestLocale: isGuestLocale(b.guestLocale) ? b.guestLocale : null,
    eligible: b.source !== "OWNER" && b.status === "CONFIRMED",
  };
}

async function lockBooking(tx: Prisma.TransactionClient, organizationId: string, bookingId: string) {
  const rows = await tx.$queryRaw<{ id: string; source: string; status: string }[]>`
    SELECT "id", "source", "status" FROM "bookings" WHERE "id" = ${bookingId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const b = rows[0];
  if (!b) throw bookingNotFound();
  if (b.source === "OWNER") throw new AppError(422, "NO_GUIDE", "Un blocage propriétaire n'a pas de guide d'accueil.");
  if (b.status !== "CONFIRMED") throw new AppError(409, "CANCELLED", "Réservation annulée : pas de guide d'accueil.");
  return b;
}

/**
 * Issues the stay's guide link, or a new one in place of the current (regenerating: the old link stops working at
 * once). Returns the token, to build the link. ADMIN only (the action checks the section's roles).
 */
export async function issueGuideLink(actor: Authorized, bookingId: string): Promise<{ token: string; regenerated: boolean }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await lockBooking(tx, organizationId, bookingId);
    const token = generateGuideToken();
    const data = { tokenHash: hashGuideToken(token), tokenEnc: encryptSecret(token, tokenContext(organizationId, bookingId)), createdById: actor.user.id, createdAt: new Date(), revokedAt: null };
    const existing = await tx.guideLink.findUnique({ where: { bookingId }, select: { bookingId: true } });
    await tx.guideLink.upsert({ where: { bookingId }, create: { bookingId, organizationId, ...data }, update: data });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "guide.link_issued", targetType: "booking", targetId: bookingId, details: { regenerated: !!existing } });
    return { token, regenerated: !!existing };
  });
}

/** Revokes the stay's guide link: it answers « introuvable » from now on (a new one can be issued later). */
export async function revokeGuideLink(actor: Authorized, bookingId: string): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId }, select: { id: true } });
    if (!b) throw bookingNotFound();
    const r = await tx.guideLink.updateMany({ where: { bookingId, organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new AppError(409, "NO_LINK", "Aucun lien actif à révoquer.");
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "guide.link_revoked", targetType: "booking", targetId: bookingId });
  });
}

/** The guest's language (guide and messages); null = from their browser. */
export async function setGuestLocale(actor: Authorized, bookingId: string, locale: GuestLocale | null): Promise<void> {
  const r = await db.booking.updateMany({ where: { id: bookingId, organizationId: actor.organizationId, source: { not: "OWNER" } }, data: { guestLocale: locale } });
  if (r.count === 0) throw bookingNotFound();
}
