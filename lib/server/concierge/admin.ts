import "server-only";
import { randomBytes } from "node:crypto";
import { canSeePartnerPrices } from "@/lib/concierge/catalog";
import { readServiceOptions, type PartnerInput, type ServiceInput, type ServiceOption } from "@/lib/concierge/form";
import { marginBps } from "@/lib/concierge/pricing";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PartnerChannel, ServiceCategory, ServicePricingModel } from "@/lib/generated/prisma/enums";
import { readLocalized, type Localized } from "@/lib/i18n/localized";
import { fileStorage } from "@/lib/storage";
import { checkPhoto, IMAGE_EXTENSION } from "@/lib/storage/images";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Conciergerie catalogue in the back-office (Lot 4b): the organization's partners and services. Every function takes
 * the caller (lib/server/authz.ts) and only touches their organization's rows: another organization's partner or
 * service is « introuvable » (404). Writes are for associés (the actions also go through requireAdminAction of the
 * ADMIN-only section) and audited in the same transaction. Agents read the catalogue with sale prices only: no partner
 * price, margin or partner contact (canSeePartnerPrices). Guests' view: lib/server/concierge/guest.ts.
 */

export const MAX_PARTNERS = 300;
export const MAX_SERVICES = 300;

const partnerNotFound = () => new AppError(404, "NOT_FOUND", "Partenaire introuvable.");
const serviceNotFound = () => new AppError(404, "NOT_FOUND", "Service introuvable.");

function requireManager(actor: Authorized) {
  if (!canSeePartnerPrices(actor.user.role)) throw new AppError(403, "FORBIDDEN", "Accès refusé.");
}

// ---------- Partners ----------

export interface PartnerView {
  id: string;
  name: string;
  type: ServiceCategory;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  preferredChannel: PartnerChannel;
  notes: string;
  active: boolean;
  serviceCount: number;
  requestCount: number;
}

const partnerSelect = {
  id: true,
  name: true,
  type: true,
  phone: true,
  whatsapp: true,
  email: true,
  preferredChannel: true,
  notes: true,
  active: true,
  _count: { select: { services: true, requests: true } },
} satisfies Prisma.PartnerSelect;

function partnerView(p: Prisma.PartnerGetPayload<{ select: typeof partnerSelect }>): PartnerView {
  const { _count, ...rest } = p;
  return { ...rest, serviceCount: _count.services, requestCount: _count.requests };
}

/** The organization's partners, active first, by name. Associés only. */
export async function listPartners(actor: Authorized): Promise<PartnerView[]> {
  requireManager(actor);
  const rows = await db.partner.findMany({ where: { organizationId: actor.organizationId }, select: partnerSelect, orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }], take: MAX_PARTNERS });
  return rows.map(partnerView);
}

export async function getPartner(actor: Authorized, id: string): Promise<PartnerView | null> {
  requireManager(actor);
  const p = await db.partner.findFirst({ where: { id, organizationId: actor.organizationId }, select: partnerSelect });
  return p && partnerView(p);
}

export async function createPartner(actor: Authorized, input: PartnerInput): Promise<{ id: string }> {
  requireManager(actor);
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    if ((await tx.partner.count({ where: { organizationId } })) >= MAX_PARTNERS) throw new AppError(422, "TOO_MANY", `${MAX_PARTNERS} partenaires au maximum.`);
    const p = await tx.partner.create({ data: { organizationId, ...input }, select: { id: true } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "partner.created", targetType: "partner", targetId: p.id, details: { name: input.name, type: input.type } });
    return p;
  });
}

export async function updatePartner(actor: Authorized, id: string, input: PartnerInput): Promise<void> {
  requireManager(actor);
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const before = await tx.partner.findFirst({ where: { id, organizationId }, select: { name: true, type: true, active: true, preferredChannel: true } });
    if (!before) throw partnerNotFound();
    await tx.partner.update({ where: { id }, data: input });
    // Contacts are not personal data of guests, but the trail keeps to what changed, without the numbers.
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "partner.updated",
      targetType: "partner",
      targetId: id,
      details: { from: before, to: { name: input.name, type: input.type, active: input.active, preferredChannel: input.preferredChannel } },
    });
  });
}

/** Deletes a partner without services nor requests; otherwise deactivate it. */
export async function deletePartner(actor: Authorized, id: string): Promise<void> {
  requireManager(actor);
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const p = await tx.partner.findFirst({ where: { id, organizationId }, select: { name: true, _count: { select: { services: true, requests: true } } } });
    if (!p) throw partnerNotFound();
    if (p._count.services || p._count.requests) throw new AppError(409, "IN_USE", "Ce partenaire a des services ou des demandes : désactivez-le plutôt.");
    await tx.partner.delete({ where: { id } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "partner.deleted", targetType: "partner", targetId: id, details: { name: p.name } });
  });
}

/** Partners a service can be given to (active ones, plus the current one when editing). */
export async function partnerChoices(actor: Authorized, currentId?: string) {
  requireManager(actor);
  return db.partner.findMany({
    where: { organizationId: actor.organizationId, OR: [{ active: true }, ...(currentId ? [{ id: currentId }] : [])] },
    select: { id: true, name: true, type: true, active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

// ---------- Services ----------

export interface ServiceView {
  id: string;
  category: ServiceCategory;
  title: Localized;
  description: Localized;
  availability: Localized;
  pricingModel: ServicePricingModel;
  salePriceCents: number | null;
  /** Associés only (null for agents, and for ON_QUOTE). */
  partnerPriceCents: number | null;
  marginCents: number | null;
  marginBps: number | null;
  /** Options; partner prices zeroed for agents. */
  options: ServiceOption[];
  leadTimeHours: number;
  position: number;
  active: boolean;
  hasPhoto: boolean;
  photoUrl: string | null;
  /** Associés only. */
  partner: { id: string; name: string; active: boolean } | null;
  requestCount: number;
}

const serviceSelect = {
  id: true,
  category: true,
  title: true,
  description: true,
  availability: true,
  pricingModel: true,
  salePriceCents: true,
  partnerPriceCents: true,
  options: true,
  leadTimeHours: true,
  position: true,
  active: true,
  photoKey: true,
  partner: { select: { id: true, name: true, active: true } },
  _count: { select: { requests: true } },
} satisfies Prisma.ServiceSelect;

function serviceView(actor: Authorized, s: Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>): ServiceView {
  const full = canSeePartnerPrices(actor.user.role);
  const margin = s.salePriceCents !== null && s.partnerPriceCents !== null ? s.salePriceCents - s.partnerPriceCents : null;
  const options = readServiceOptions(s.options);
  return {
    id: s.id,
    category: s.category,
    title: readLocalized(s.title),
    description: readLocalized(s.description),
    availability: readLocalized(s.availability),
    pricingModel: s.pricingModel,
    salePriceCents: s.salePriceCents,
    partnerPriceCents: full ? s.partnerPriceCents : null,
    marginCents: full ? margin : null,
    marginBps: full && margin !== null && s.salePriceCents !== null ? marginBps(s.salePriceCents, margin) : null,
    options: full ? options : options.map((o) => ({ ...o, partnerCents: 0 })),
    leadTimeHours: s.leadTimeHours,
    position: s.position,
    active: s.active,
    hasPhoto: !!s.photoKey,
    photoUrl: s.photoKey ? fileStorage().url(s.photoKey) : null,
    partner: full ? s.partner : null,
    requestCount: full ? s._count.requests : 0,
  };
}

export interface ServiceFilters {
  category?: ServiceCategory;
  /** Agents never see inactive services. */
  includeInactive?: boolean;
}

/** The catalogue as the caller may see it, by category, position and title. */
export async function listServices(actor: Authorized, f: ServiceFilters = {}): Promise<ServiceView[]> {
  const full = canSeePartnerPrices(actor.user.role);
  const rows = await db.service.findMany({
    where: { organizationId: actor.organizationId, ...(f.category && { category: f.category }), ...(!(full && f.includeInactive) && { active: true }) },
    select: serviceSelect,
    orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: MAX_SERVICES,
  });
  return rows.map((r) => serviceView(actor, r));
}

/** One service for its edit page (associés). */
export async function getService(actor: Authorized, id: string): Promise<ServiceView | null> {
  requireManager(actor);
  const s = await db.service.findFirst({ where: { id, organizationId: actor.organizationId }, select: serviceSelect });
  return s && serviceView(actor, s);
}

async function assertPartner(tx: Prisma.TransactionClient, organizationId: string, partnerId: string, allowInactive: string | null) {
  const p = await tx.partner.findFirst({ where: { id: partnerId, organizationId }, select: { id: true, active: true } });
  if (!p) throw new AppError(422, "INVALID_PARTNER", "Partenaire : choisissez dans la liste.");
  if (!p.active && p.id !== allowInactive) throw new AppError(422, "INVALID_PARTNER", "Ce partenaire est désactivé : choisissez-en un autre ou réactivez-le.");
}

function serviceData(input: ServiceInput) {
  return {
    partnerId: input.partnerId,
    category: input.category,
    title: input.title,
    description: input.description,
    availability: input.availability,
    pricingModel: input.pricingModel,
    salePriceCents: input.salePriceCents,
    partnerPriceCents: input.partnerPriceCents,
    options: input.options as unknown as Prisma.InputJsonArray,
    leadTimeHours: input.leadTimeHours,
    position: input.position,
    active: input.active,
  };
}

/** What the audit trail keeps of a service: prices and settings, never texts in full. */
function auditOf(input: ServiceInput | Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>) {
  return {
    title: readLocalized(input.title).fr ?? "",
    category: input.category,
    pricingModel: input.pricingModel,
    salePriceCents: input.salePriceCents,
    partnerPriceCents: input.partnerPriceCents,
    options: readServiceOptions(input.options).map((o) => ({ id: o.id, saleCents: o.saleCents, partnerCents: o.partnerCents, perUnit: o.perUnit })),
    leadTimeHours: input.leadTimeHours,
    active: input.active,
    partnerId: "partner" in input ? input.partner.id : input.partnerId,
  };
}

export async function createService(actor: Authorized, input: ServiceInput): Promise<{ id: string }> {
  requireManager(actor);
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await assertPartner(tx, organizationId, input.partnerId, null);
    if ((await tx.service.count({ where: { organizationId } })) >= MAX_SERVICES) throw new AppError(422, "TOO_MANY", `${MAX_SERVICES} services au maximum.`);
    const s = await tx.service.create({ data: { organizationId, ...serviceData(input) }, select: { id: true } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "service.created", targetType: "service", targetId: s.id, details: auditOf(input) });
    return s;
  });
}

/** Changes a service. Requests already made keep their price snapshot. */
export async function updateService(actor: Authorized, id: string, input: ServiceInput): Promise<void> {
  requireManager(actor);
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const before = await tx.service.findFirst({ where: { id, organizationId }, select: serviceSelect });
    if (!before) throw serviceNotFound();
    await assertPartner(tx, organizationId, input.partnerId, before.partner.id);
    await tx.service.update({ where: { id }, data: serviceData(input) });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "service.updated", targetType: "service", targetId: id, details: { from: auditOf(before), to: auditOf(input) } });
  });
}

/** Deletes a service never requested (with its photo); otherwise deactivate it. */
export async function deleteService(actor: Authorized, id: string): Promise<void> {
  requireManager(actor);
  const { organizationId } = actor;
  const key = await db.$transaction(async (tx) => {
    const s = await tx.service.findFirst({ where: { id, organizationId }, select: { title: true, photoKey: true, _count: { select: { requests: true } } } });
    if (!s) throw serviceNotFound();
    if (s._count.requests) throw new AppError(409, "IN_USE", "Ce service a déjà été demandé : désactivez-le plutôt.");
    await tx.service.delete({ where: { id } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "service.deleted", targetType: "service", targetId: id, details: { title: readLocalized(s.title).fr ?? "" } });
    return s.photoKey;
  });
  if (key) await fileStorage().delete(key).catch(() => {});
}

/** Sets (or replaces) the service's photo: JPEG, PNG or WebP by content, 5 MB at most. */
export async function setServicePhoto(actor: Authorized, id: string, bytes: Uint8Array): Promise<void> {
  requireManager(actor);
  const { organizationId } = actor;
  const check = checkPhoto(bytes);
  if (!check.ok) throw new AppError(422, "INVALID_PHOTO", check.message);
  if (!(await db.service.count({ where: { id, organizationId } }))) throw serviceNotFound();
  const storage = fileStorage();
  const key = `services/${organizationId}/${id}/${randomBytes(16).toString("hex")}.${IMAGE_EXTENSION[check.type]}`;
  await storage.put(key, bytes, check.type);
  let old: string | null = null;
  try {
    old = await db.$transaction(async (tx) => {
      const s = await tx.service.findFirst({ where: { id, organizationId }, select: { photoKey: true } });
      if (!s) throw serviceNotFound();
      await tx.service.update({ where: { id }, data: { photoKey: key } });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "service.photo_updated", targetType: "service", targetId: id, details: { replaced: !!s.photoKey } });
      return s.photoKey;
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
  if (old) await storage.delete(old).catch(() => {});
}

export async function removeServicePhoto(actor: Authorized, id: string): Promise<void> {
  requireManager(actor);
  const { organizationId } = actor;
  const old = await db.$transaction(async (tx) => {
    const s = await tx.service.findFirst({ where: { id, organizationId }, select: { photoKey: true } });
    if (!s) throw serviceNotFound();
    if (!s.photoKey) return null;
    await tx.service.update({ where: { id }, data: { photoKey: null } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "service.photo_updated", targetType: "service", targetId: id, details: { removed: true } });
    return s.photoKey;
  });
  if (old) await fileStorage().delete(old).catch(() => {});
}

/** Who may see a service photo (app/media): the staff of its organization. */
export async function servicePhotoAccess(storageKey: string): Promise<{ organizationId: string } | null> {
  return db.service.findUnique({ where: { photoKey: storageKey }, select: { organizationId: true } });
}
