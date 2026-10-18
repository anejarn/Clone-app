import "server-only";
import { randomBytes } from "node:crypto";
import { addDays, isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { canCaptureForTask } from "@/lib/declarations/access";
import type { DeclarationRow } from "@/lib/declarations/exporters";
import { purgeDate } from "@/lib/declarations/retention";
import { parseTravelerForm, TRAVELER_LIMITS, travelerName, type TravelerFieldErrors, type TravelerIdentity } from "@/lib/declarations/traveler-form";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource, BookingStatus } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { decryptDocument, decryptIdentity, encryptDocument, encryptIdentity } from "@/lib/secrets/identity";
import { fileStorage } from "@/lib/storage";
import { MAX_PHOTO_BYTES, sniffImageType } from "@/lib/storage/images";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";
import { refreshBookingTax } from "./tax";

/**
 * Travellers' identity documents (Lot 5: déclaration des voyageurs, fiche de police). Every function takes the caller
 * (lib/server/authz.ts) and a scope, and only reads or writes the caller's organization: another organization's id is
 * « introuvable », as an unknown one.
 *
 * Who (rule: lib/declarations/access.ts):
 * - an associé (ADMIN) lists, searches, views, adds, changes, deletes and declares every fiche, from Déclarations
 *   (scope { bookingId }) or from a welcome task (scope { taskId });
 * - an agent (AGENT) only through the welcome task (CHECKIN) assigned to them, today or tomorrow, not done nor
 *   cancelled (scope { taskId }): they add and correct that stay's fiches and photograph the documents, and never see
 *   a document photo. After the task, nothing.
 * Every reading of decrypted fiches is audited (« travelers.viewed », with a count), every change and every view of a
 * document scan too; the audit holds ids and counts only, never a value.
 *
 * Storage: the fiche as one envelope (lib/secrets/identity.ts), the scans encrypted before lib/storage gets them
 * (identity/<org>/<booking>/<random>.enc). The taxe de séjour of the stay follows every change (tax.ts).
 */

export type CaptureScope = { bookingId: string } | { taskId: string };

const bookingNotFound = () => new AppError(404, "NOT_FOUND", "Réservation introuvable.");
const travelerNotFound = () => new AppError(404, "NOT_FOUND", "Fiche voyageur introuvable.");
const taskRefused = () =>
  new AppError(404, "NOT_FOUND", "Fiches voyageurs indisponibles pour cette tâche (réservées à l'accueil qui vous est confié aujourd'hui ou demain).");

export const MAX_DOCUMENT_BYTES = MAX_PHOTO_BYTES;
export type DocumentType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** JPEG, PNG, WebP or PDF by their first bytes; null for anything else. */
export function sniffDocumentType(bytes: Uint8Array): DocumentType | null {
  const image = sniffImageType(bytes);
  if (image) return image;
  // "%PDF-"
  if ([0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => bytes[i] === b)) return "application/pdf";
  return null;
}

export function capturesToday(now = Date.now()): Date {
  return todayInTimeZone(MARRAKECH_TIMEZONE, now);
}

export interface StayInfo {
  bookingId: string;
  listingId: string;
  listingTitle: string;
  guestName: string | null;
  source: BookingSource;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  via: "admin" | "task";
  taskId: string | null;
}

const staySelect = {
  id: true,
  organizationId: true,
  listingId: true,
  source: true,
  status: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  infants: true,
  guestName: true,
  guest: { select: { name: true } },
  listing: { select: { title: true } },
} satisfies Prisma.BookingSelect;

/** The stay a scope opens for this caller, or a 404. Owner blocks have no travellers. */
async function resolveScope(tx: Prisma.TransactionClient, actor: Authorized, scope: CaptureScope, today: Date): Promise<StayInfo> {
  const { organizationId } = actor;
  let bookingId: string;
  let taskId: string | null = null;
  if ("taskId" in scope) {
    const task = await tx.task.findFirst({
      where: { id: scope.taskId, organizationId },
      select: { id: true, type: true, bookingId: true, assigneeId: true, scheduledDate: true, status: true },
    });
    if (!task || !canCaptureForTask({ role: actor.user.role, userId: actor.user.id }, task, today)) throw taskRefused();
    bookingId = task.bookingId!;
    taskId = task.id;
  } else {
    // Déclarations: associés only.
    if (actor.user.role !== "ADMIN") throw bookingNotFound();
    bookingId = scope.bookingId;
  }
  const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId }, select: staySelect });
  if (!b || b.source === "OWNER") throw bookingNotFound();
  return {
    bookingId: b.id,
    listingId: b.listingId,
    listingTitle: b.listing.title,
    guestName: b.guestName ?? b.guest?.name ?? null,
    source: b.source,
    status: b.status,
    checkIn: isoDay(b.checkIn),
    checkOut: isoDay(b.checkOut),
    adults: b.adults,
    children: b.children,
    infants: b.infants,
    via: taskId ? "task" : "admin",
    taskId,
  };
}

const travelerCtx = (organizationId: string, bookingId: string, travelerId: string) => ({ organizationId, bookingId, travelerId });

export interface TravelerView {
  id: string;
  identity: TravelerIdentity;
  isMinor: boolean;
  guardianId: string | null;
  guardianName: string | null;
  declaredAt: string | null;
  documents: { id: string; contentType: string; createdAt: string }[];
}

async function readTravelers(tx: Prisma.TransactionClient, organizationId: string, bookingId: string): Promise<TravelerView[]> {
  const rows = await tx.traveler.findMany({
    where: { bookingId, organizationId },
    select: { id: true, identityEnc: true, isMinor: true, guardianId: true, declaredAt: true, documents: { select: { id: true, contentType: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
    orderBy: [{ isMinor: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const views = rows.map((r) => ({
    id: r.id,
    identity: decryptIdentity<TravelerIdentity>(r.identityEnc, travelerCtx(organizationId, bookingId, r.id)),
    isMinor: r.isMinor,
    guardianId: r.guardianId,
    guardianName: null as string | null,
    declaredAt: r.declaredAt?.toISOString() ?? null,
    documents: r.documents.map((d) => ({ id: d.id, contentType: d.contentType, createdAt: d.createdAt.toISOString() })),
  }));
  const byId = new Map(views.map((v) => [v.id, v]));
  for (const v of views) if (v.guardianId) v.guardianName = byId.has(v.guardianId) ? travelerName(byId.get(v.guardianId)!.identity) : null;
  return views;
}

export interface PurgeInfo {
  purgedAt: string;
  travelerCount: number;
}

/** The fiches of a stay, decrypted, for the capture screens. Audited when there is at least one. */
export async function travelersForCapture(actor: Authorized, scope: CaptureScope, today = capturesToday()) {
  return db.$transaction(async (tx) => {
    const stay = await resolveScope(tx, actor, scope, today);
    const travelers = await readTravelers(tx, actor.organizationId, stay.bookingId);
    if (travelers.length) {
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.user.id,
        action: "travelers.viewed",
        targetType: "booking",
        targetId: stay.bookingId,
        details: { via: stay.via, count: travelers.length, ...(stay.taskId && { taskId: stay.taskId }) },
      });
    }
    const purge = await tx.identityPurge.findFirst({ where: { organizationId: actor.organizationId, bookingId: stay.bookingId }, orderBy: { purgedAt: "desc" } });
    // An agent never gets the document ids' content anyway; the list only says a photo is there.
    return { stay, travelers, purge: purge ? ({ purgedAt: purge.purgedAt.toISOString(), travelerCount: purge.travelerCount } satisfies PurgeInfo) : null };
  });
}

export type SaveTravelerResult = { ok: true; id: string; documentError?: string } | { ok: false; fieldErrors: TravelerFieldErrors };

async function lockBooking(tx: Prisma.TransactionClient, organizationId: string, bookingId: string) {
  await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId} AND "organizationId" = ${organizationId} FOR UPDATE`;
}

function assertWritable(stay: StayInfo) {
  if (stay.status !== "CONFIRMED") throw new AppError(409, "CANCELLED", "Ce séjour est annulé : ses fiches voyageurs ne se modifient plus.");
}

/**
 * Adds (travelerId null) or changes a fiche from the form's values; optionally with a first document photo (adding
 * only). Field errors come back as such; everything else is an AppError.
 */
export async function saveTraveler(
  actor: Authorized,
  scope: CaptureScope,
  travelerId: string | null,
  values: Record<string, string>,
  document?: Uint8Array | null,
  today = capturesToday(),
): Promise<SaveTravelerResult> {
  const { organizationId } = actor;
  const docType = document && document.byteLength ? checkDocument(document) : null;
  const result = await db.$transaction(async (tx): Promise<SaveTravelerResult & { bookingId?: string }> => {
    const stay = await resolveScope(tx, actor, scope, today);
    assertWritable(stay);
    await lockBooking(tx, organizationId, stay.bookingId);
    const parsed = parseTravelerForm(values, stay);
    if (!parsed.ok) return parsed;
    const { identity, isMinor, guardianId } = parsed;
    if (guardianId) {
      const g = await tx.traveler.findFirst({ where: { id: guardianId, bookingId: stay.bookingId, organizationId, isMinor: false }, select: { id: true } });
      if (!g || g.id === travelerId) return { ok: false, fieldErrors: { guardianId: "Choisissez un adulte de ce séjour." } };
    }
    let id: string;
    if (travelerId) {
      const existing = await tx.traveler.findFirst({ where: { id: travelerId, bookingId: stay.bookingId, organizationId }, select: { id: true, _count: { select: { minors: true } } } });
      if (!existing) throw travelerNotFound();
      if (isMinor && existing._count.minors > 0) return { ok: false, fieldErrors: { birthDate: "Ce voyageur accompagne des mineurs : il doit être majeur." } };
      id = existing.id;
      await tx.traveler.update({
        where: { id },
        data: { identityEnc: encryptIdentity(identity, travelerCtx(organizationId, stay.bookingId, id)), isMinor, guardianId, updatedById: actor.user.id },
      });
    } else {
      const count = await tx.traveler.count({ where: { bookingId: stay.bookingId } });
      if (count >= TRAVELER_LIMITS.travelersPerBooking) throw new AppError(422, "TOO_MANY_TRAVELERS", `${TRAVELER_LIMITS.travelersPerBooking} voyageurs au maximum par séjour.`);
      id = `trv${randomBytes(12).toString("hex")}`;
      await tx.traveler.create({
        data: {
          id,
          organizationId,
          bookingId: stay.bookingId,
          identityEnc: encryptIdentity(identity, travelerCtx(organizationId, stay.bookingId, id)),
          isMinor,
          guardianId,
          createdById: actor.user.id,
          updatedById: actor.user.id,
        },
      });
    }
    await refreshBookingTax(tx, organizationId, stay.bookingId, actor.user.id);
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: travelerId ? "traveler.updated" : "traveler.added",
      targetType: "booking",
      targetId: stay.bookingId,
      details: { travelerId: id, minor: isMinor, via: stay.via, ...(stay.taskId && { taskId: stay.taskId }) },
    });
    return { ok: true, id, bookingId: stay.bookingId };
  });
  if (!result.ok) return result;
  if (docType && document) {
    try {
      await storeDocument(actor, scope, result.id, document, docType, today);
    } catch (e) {
      if (e instanceof AppError) return { ok: true, id: result.id, documentError: e.message };
      throw e;
    }
  }
  return { ok: true, id: result.id };
}

export async function deleteTraveler(actor: Authorized, scope: CaptureScope, travelerId: string, today = capturesToday()): Promise<void> {
  const { organizationId } = actor;
  const keys = await db.$transaction(async (tx) => {
    const stay = await resolveScope(tx, actor, scope, today);
    await lockBooking(tx, organizationId, stay.bookingId);
    const t = await tx.traveler.findFirst({
      where: { id: travelerId, bookingId: stay.bookingId, organizationId },
      select: { id: true, isMinor: true, _count: { select: { minors: true } }, documents: { select: { storageKey: true } } },
    });
    if (!t) throw travelerNotFound();
    if (t._count.minors > 0) throw new AppError(409, "HAS_MINORS", "Ce voyageur accompagne des mineurs : supprimez d'abord leurs fiches.");
    await tx.traveler.delete({ where: { id: t.id } });
    await refreshBookingTax(tx, organizationId, stay.bookingId, actor.user.id);
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "traveler.deleted",
      targetType: "booking",
      targetId: stay.bookingId,
      details: { travelerId: t.id, minor: t.isMinor, documents: t.documents.length, via: stay.via },
    });
    return t.documents.map((d) => d.storageKey);
  });
  for (const k of keys) await fileStorage().delete(k).catch((e) => console.error(`identity document ${k} not deleted: ${(e as Error).message}`));
}

// ---------- Document scans ----------

function checkDocument(bytes: Uint8Array): DocumentType {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new AppError(422, "INVALID_DOCUMENT", `Fichier trop lourd : ${MAX_DOCUMENT_BYTES / 1024 / 1024} Mo au maximum.`);
  const type = sniffDocumentType(bytes);
  if (!type) throw new AppError(422, "INVALID_DOCUMENT", "Format non accepté : photo JPEG, PNG, WebP ou PDF.");
  return type;
}

async function storeDocument(actor: Authorized, scope: CaptureScope, travelerId: string, bytes: Uint8Array, type: DocumentType, today: Date): Promise<{ id: string }> {
  const { organizationId } = actor;
  // Where it goes (checked again in the transaction).
  const stay = await db.$transaction((tx) => resolveScope(tx, actor, scope, today));
  const storageKey = `identity/${organizationId}/${stay.bookingId}/${randomBytes(16).toString("hex")}.enc`;
  const sealed = encryptDocument(bytes, { organizationId, travelerId, storageKey });
  const storage = fileStorage();
  await storage.put(storageKey, sealed, "application/octet-stream");
  try {
    return await db.$transaction(async (tx) => {
      const again = await resolveScope(tx, actor, scope, today);
      assertWritable(again);
      const t = await tx.traveler.findFirst({ where: { id: travelerId, bookingId: again.bookingId, organizationId }, select: { id: true, _count: { select: { documents: true } } } });
      if (!t) throw travelerNotFound();
      if (t._count.documents >= TRAVELER_LIMITS.documentsPerTraveler) throw new AppError(422, "TOO_MANY_DOCUMENTS", `${TRAVELER_LIMITS.documentsPerTraveler} photos au maximum par voyageur (recto, verso…).`);
      const doc = await tx.travelerDocument.create({ data: { organizationId, travelerId: t.id, storageKey, contentType: type, byteSize: bytes.byteLength, uploadedById: actor.user.id }, select: { id: true } });
      await recordAudit(tx, {
        organizationId,
        actorId: actor.user.id,
        action: "traveler.document_added",
        targetType: "booking",
        targetId: again.bookingId,
        details: { travelerId: t.id, documentId: doc.id, via: again.via },
      });
      return doc;
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => {});
    throw e;
  }
}

/** A photo or scan of a traveller's document, encrypted before storage. */
export async function addTravelerDocument(actor: Authorized, scope: CaptureScope, travelerId: string, bytes: Uint8Array, today = capturesToday()): Promise<{ id: string }> {
  return storeDocument(actor, scope, travelerId, bytes, checkDocument(bytes), today);
}

export async function deleteTravelerDocument(actor: Authorized, scope: CaptureScope, documentId: string, today = capturesToday()): Promise<void> {
  const { organizationId } = actor;
  const key = await db.$transaction(async (tx) => {
    const stay = await resolveScope(tx, actor, scope, today);
    const d = await tx.travelerDocument.findFirst({ where: { id: documentId, organizationId, traveler: { bookingId: stay.bookingId } }, select: { id: true, storageKey: true, travelerId: true } });
    if (!d) throw new AppError(404, "NOT_FOUND", "Photo introuvable.");
    await tx.travelerDocument.delete({ where: { id: d.id } });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "traveler.document_deleted",
      targetType: "booking",
      targetId: stay.bookingId,
      details: { travelerId: d.travelerId, documentId: d.id, via: stay.via },
    });
    return d.storageKey;
  });
  await fileStorage().delete(key).catch((e) => console.error(`identity document ${key} not deleted: ${(e as Error).message}`));
}

/** The clear bytes of a document, for an associé only (audited). Null when unknown or another organization's. */
export async function readTravelerDocument(actor: Authorized, documentId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (actor.user.role !== "ADMIN") return null;
  const { organizationId } = actor;
  const d = await db.travelerDocument.findFirst({ where: { id: documentId, organizationId }, select: { id: true, storageKey: true, contentType: true, travelerId: true, traveler: { select: { bookingId: true } } } });
  if (!d) return null;
  const file = await fileStorage().get(d.storageKey);
  if (!file) return null;
  const bytes = decryptDocument(file.bytes, { organizationId, travelerId: d.travelerId, storageKey: d.storageKey });
  await db.$transaction((tx) =>
    recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "traveler.document_viewed",
      targetType: "booking",
      targetId: d.traveler.bookingId,
      details: { travelerId: d.travelerId, documentId: d.id },
    }),
  );
  return { bytes, contentType: d.contentType };
}

// ---------- Declared ----------

/** Marks every traveller of a stay declared (télé-déclaration done), or takes the mark back. ADMIN. */
export async function setDeclared(actor: Authorized, bookingId: string, declared: boolean): Promise<number> {
  if (actor.user.role !== "ADMIN") throw bookingNotFound();
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId, source: { not: "OWNER" } }, select: { id: true } });
    if (!b) throw bookingNotFound();
    const r = declared
      ? await tx.traveler.updateMany({ where: { bookingId: b.id, organizationId, declaredAt: null }, data: { declaredAt: new Date(), declaredById: actor.user.id } })
      : await tx.traveler.updateMany({ where: { bookingId: b.id, organizationId, declaredAt: { not: null } }, data: { declaredAt: null, declaredById: null } });
    if (declared && r.count === 0 && (await tx.traveler.count({ where: { bookingId: b.id } })) === 0) {
      throw new AppError(422, "NO_TRAVELER", "Enregistrez d'abord les fiches des voyageurs de ce séjour.");
    }
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: declared ? "travelers.declared" : "travelers.undeclared", targetType: "booking", targetId: b.id, details: { count: r.count } });
    return r.count;
  });
}

// ---------- Summaries (no personal data) ----------

export interface TravelerSummary {
  travelers: number;
  adults: number;
  minors: number;
  declared: number;
  documents: number;
  /** All adults recorded and declared. */
  complete: boolean;
  purge: PurgeInfo | null;
  /** When this stay's fiches will be deleted. */
  purgeOn: string;
}

/** Counts only, without decrypting: for the booking's page and lists. */
export async function travelerSummary(organizationId: string, bookingId: string): Promise<TravelerSummary | null> {
  const b = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: { checkOut: true, adults: true, source: true, organization: { select: { identityRetentionDays: true } }, travelers: { select: { isMinor: true, declaredAt: true, _count: { select: { documents: true } } } } },
  });
  if (!b || b.source === "OWNER") return null;
  const purge = await db.identityPurge.findFirst({ where: { organizationId, bookingId }, orderBy: { purgedAt: "desc" } });
  const adults = b.travelers.filter((t) => !t.isMinor);
  return {
    travelers: b.travelers.length,
    adults: adults.length,
    minors: b.travelers.length - adults.length,
    declared: b.travelers.filter((t) => t.declaredAt).length,
    documents: b.travelers.reduce((s, t) => s + t._count.documents, 0),
    complete: adults.length >= Math.max(1, b.adults) && adults.every((t) => t.declaredAt),
    purge: purge ? { purgedAt: purge.purgedAt.toISOString(), travelerCount: purge.travelerCount } : null,
    purgeOn: purgeDate(isoDay(b.checkOut), b.organization.identityRetentionDays),
  };
}

const undeclaredWhere = (organizationId: string, from: Date, to: Date): Prisma.BookingWhereInput => ({
  organizationId,
  status: "CONFIRMED",
  source: { not: "OWNER" },
  checkIn: { gte: from, lte: to },
  // No adult recorded yet, or an adult not declared.
  OR: [{ travelers: { none: { isMinor: false } } }, { travelers: { some: { isMinor: false, declaredAt: null } } }],
});

export interface UndeclaredArrival {
  bookingId: string;
  listingTitle: string;
  guestName: string | null;
  checkIn: string;
  travelers: number;
}

/**
 * Arrivals of yesterday and today (Marrakech) not declared yet: no adult traveller recorded, or one not marked
 * declared. The dashboard's alert (« arrivées des dernières 24 h non déclarées »).
 */
export async function undeclaredArrivals(organizationId: string, today = capturesToday(), take = 20): Promise<{ count: number; items: UndeclaredArrival[] }> {
  const where = undeclaredWhere(organizationId, addDays(today, -1), today);
  const [count, rows] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({
      where,
      select: { id: true, checkIn: true, guestName: true, guest: { select: { name: true } }, listing: { select: { title: true } }, _count: { select: { travelers: true } } },
      orderBy: [{ checkIn: "asc" }, { id: "asc" }],
      take,
    }),
  ]);
  return {
    count,
    items: rows.map((r) => ({ bookingId: r.id, listingTitle: r.listing.title, guestName: r.guestName ?? r.guest?.name ?? null, checkIn: isoDay(r.checkIn), travelers: r._count.travelers })),
  };
}

// ---------- Listing and export (ADMIN) ----------

export interface DeclarationFilters {
  /** Arrivals from this day (included)… */
  from: Date;
  /** …to this day (included). */
  to: Date;
  listingId?: string;
  undeclaredOnly?: boolean;
  /** Name or document number, case- and accent-insensitive. */
  q?: string;
}

export const MAX_RANGE_DAYS = 366;

export interface DeclarationStay {
  bookingId: string;
  listingId: string;
  listingTitle: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  guestName: string | null;
  travelers: TravelerView[];
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

async function declarationStays(tx: Prisma.TransactionClient, organizationId: string, f: DeclarationFilters) {
  if (f.to < f.from || (f.to.getTime() - f.from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new AppError(422, "INVALID_RANGE", `Choisissez une période de ${MAX_RANGE_DAYS} jours au plus, la fin après le début.`);
  }
  const rows = await tx.booking.findMany({
    where: {
      organizationId,
      source: { not: "OWNER" },
      checkIn: { gte: f.from, lte: f.to },
      ...(f.listingId && { listingId: f.listingId }),
      travelers: f.undeclaredOnly ? { some: { declaredAt: null } } : { some: {} },
    },
    select: { ...staySelect, externalRef: true, listing: { select: { title: true, address: true, city: true, licenseNumber: true } } },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
    take: 1000,
  });
  const q = f.q ? fold(f.q.trim()) : "";
  const stays: (DeclarationStay & { externalRef: string | null; listing: { title: string; address: string; city: string; licenseNumber: string | null } })[] = [];
  for (const b of rows) {
    let travelers = await readTravelers(tx, organizationId, b.id);
    if (f.undeclaredOnly) travelers = travelers.filter((t) => !t.declaredAt);
    if (q) travelers = travelers.filter((t) => fold(`${t.identity.lastName} ${t.identity.firstName} ${t.identity.documentNumber}`).includes(q));
    if (!travelers.length) continue;
    stays.push({
      bookingId: b.id,
      listingId: b.listingId,
      listingTitle: b.listing.title,
      checkIn: isoDay(b.checkIn),
      checkOut: isoDay(b.checkOut),
      adults: b.adults,
      children: b.children,
      infants: b.infants,
      guestName: b.guestName ?? b.guest?.name ?? null,
      travelers,
      externalRef: b.externalRef,
      listing: b.listing,
    });
  }
  return stays;
}

/** Déclarations' list: the fiches of the arrivals in a period, decrypted (audited, with the count). */
export async function searchDeclarations(actor: Authorized, f: DeclarationFilters): Promise<DeclarationStay[]> {
  if (actor.user.role !== "ADMIN") throw bookingNotFound();
  return db.$transaction(async (tx) => {
    const stays = await declarationStays(tx, actor.organizationId, f);
    const count = stays.reduce((s, x) => s + x.travelers.length, 0);
    if (count) {
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.user.id,
        action: "travelers.viewed",
        targetType: "organization",
        targetId: actor.organizationId,
        details: { via: "list", count, from: isoDay(f.from), to: isoDay(f.to), ...(f.q && { search: true }) },
      });
    }
    return stays.map((s): DeclarationStay => ({
      bookingId: s.bookingId,
      listingId: s.listingId,
      listingTitle: s.listingTitle,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      adults: s.adults,
      children: s.children,
      infants: s.infants,
      guestName: s.guestName,
      travelers: s.travelers,
    }));
  });
}

/** The rows of an export (CSV, fiches), audited « declaration.exported » with the format and the count. */
export async function declarationRows(actor: Authorized, f: DeclarationFilters, format: string): Promise<DeclarationRow[]> {
  if (actor.user.role !== "ADMIN") throw bookingNotFound();
  return db.$transaction(async (tx) => {
    const stays = await declarationStays(tx, actor.organizationId, f);
    const rows: DeclarationRow[] = stays.flatMap((s) =>
      s.travelers.map((t) => ({
        travelerId: t.id,
        bookingId: s.bookingId,
        identity: t.identity,
        isMinor: t.isMinor,
        guardianName: t.guardianName,
        declaredAt: t.declaredAt ? isoDay(new Date(t.declaredAt)) : null,
        establishment: { name: s.listing.title, address: s.listing.address, city: s.listing.city, licenseNumber: s.listing.licenseNumber },
        bookingRef: s.externalRef ?? s.bookingId,
      })),
    );
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "declaration.exported",
      targetType: "organization",
      targetId: actor.organizationId,
      details: { format, count: rows.length, stays: stays.length, from: isoDay(f.from), to: isoDay(f.to), ...(f.listingId && { listingId: f.listingId }), ...(f.undeclaredOnly && { undeclaredOnly: true }) },
    });
    return rows;
  });
}
