import "server-only";
import { isPlatformSource, PLATFORM_SOURCES, type PlatformSource } from "@/lib/admin/booking-sources";
import { hostMatches, platform } from "@/lib/channels/platforms";
import { exportUrl, generateExportToken, hashExportToken } from "@/lib/channels/token";
import { allowPrivateFromEnv, validateFeedUrl } from "@/lib/channels/url";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ChannelSyncOutcome } from "@/lib/generated/prisma/enums";
import { decryptSecret, encryptSecret, SecretDecryptError, type SecretContext } from "@/lib/secrets/access-codes";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * A listing's links with the platforms (Biens → a home → Plateformes), ADMIN only (the actions check the section's
 * roles): export links (issue, regenerate, revoke), the platforms' import links (set, replace, remove), the home's
 * preparation days and minimum notice. Every function takes the caller's organization: another organization's
 * listing is « introuvable ». Secrets (tokens, URLs) are encrypted (lib/secrets/access-codes.ts) and never written to
 * the audit trail.
 */

export const STALE_AFTER_MS = 60 * 60_000;

const listingNotFound = () => new AppError(404, "NOT_FOUND", "Bien introuvable.");

export function exportContext(organizationId: string, listingId: string, source: string): SecretContext {
  return { organizationId, listingId, purpose: "ical-export-token", scope: source };
}

export function importContext(organizationId: string, listingId: string, source: string): SecretContext {
  return { organizationId, listingId, purpose: "ical-import-url", scope: source };
}

export function parseSource(s: unknown): PlatformSource {
  if (typeof s !== "string" || !isPlatformSource(s)) throw new AppError(404, "NOT_FOUND", "Plateforme inconnue.");
  return s;
}

async function homeOf(tx: Prisma.TransactionClient, organizationId: string, listingId: string) {
  const l = await tx.listing.findFirst({ where: { id: listingId, organizationId, category: "HOME" }, select: { id: true } });
  if (!l) throw listingNotFound();
  return l;
}

export type FeedHealth = "NONE" | "OK" | "PENDING" | "FAILING" | "STALE";

/** An import's state: not set, fine, never read yet, last read failed, or not read successfully for over an hour. */
export function feedHealth(
  f: { importUrlEnc?: string | null; hasImport?: boolean; importEnabled: boolean; lastStatus: ChannelSyncOutcome | null; lastSuccessAt: Date | null; importUrlSetAt: Date | null },
  now = Date.now(),
): FeedHealth {
  const has = f.hasImport ?? !!f.importUrlEnc;
  if (!has || !f.importEnabled) return "NONE";
  const since = (f.lastSuccessAt ?? f.importUrlSetAt)?.getTime() ?? now;
  if (now - since > STALE_AFTER_MS) return "STALE";
  if (f.lastStatus === "ERROR") return "FAILING";
  if (!f.lastSuccessAt) return "PENDING";
  return "OK";
}

export interface FeedView {
  source: PlatformSource;
  label: string;
  importHint: string;
  exportHint: string;
  feedId: string | null;
  /** The export link, for an active one. */
  exportUrl: string | null;
  exportRevoked: boolean;
  exportIssuedAt: Date | null;
  importHost: string | null;
  health: FeedHealth;
  lastSuccessAt: Date | null;
  lastSyncAt: Date | null;
  lastStatus: ChannelSyncOutcome | null;
  lastError: string | null;
  nextSyncAt: Date | null;
}

/** The home's six platforms, with their feed when one exists. Null for another organization's or unknown listing. */
export async function listingChannels(organizationId: string, listingId: string, origin: string, now = Date.now()) {
  const l = await db.listing.findFirst({
    where: { id: listingId, organizationId, category: "HOME" },
    select: { id: true, title: true, preparationDays: true, minNoticeDays: true, place: { select: { name: true } }, channelFeeds: true },
  });
  if (!l) return null;
  const feeds: FeedView[] = PLATFORM_SOURCES.map((source) => {
    const p = platform(source);
    const f = l.channelFeeds.find((x) => x.source === source);
    let url: string | null = null;
    if (f && !f.exportRevokedAt) {
      try {
        url = exportUrl(origin, decryptSecret(f.exportTokenEnc, exportContext(organizationId, l.id, source)));
      } catch (e) {
        if (!(e instanceof SecretDecryptError)) throw e;
        console.error(`export link of feed ${f.id} unreadable: ${e.message}`);
      }
    }
    return {
      source,
      label: p.label,
      importHint: p.importHint,
      exportHint: p.exportHint,
      feedId: f?.id ?? null,
      exportUrl: url,
      exportRevoked: !!f?.exportRevokedAt,
      exportIssuedAt: f?.exportIssuedAt ?? null,
      importHost: f?.importHost ?? null,
      health: f ? feedHealth(f, now) : "NONE",
      lastSuccessAt: f?.lastSuccessAt ?? null,
      lastSyncAt: f?.lastSyncAt ?? null,
      lastStatus: f?.lastStatus ?? null,
      lastError: f?.lastError ?? null,
      nextSyncAt: f?.importUrlEnc ? f.nextSyncAt : null,
    };
  });
  return { id: l.id, title: l.title, placeName: l.place.name, preparationDays: l.preparationDays, minNoticeDays: l.minNoticeDays, feeds };
}

function newToken(organizationId: string, listingId: string, source: string) {
  const token = generateExportToken();
  return { token, data: { exportTokenHash: hashExportToken(token), exportTokenEnc: encryptSecret(token, exportContext(organizationId, listingId, source)) } };
}

/** The feed of a listing and platform, created (with an export token) when missing. */
export async function ensureFeed(tx: Prisma.TransactionClient, organizationId: string, listingId: string, source: PlatformSource) {
  const existing = await tx.channelFeed.findUnique({ where: { listingId_source: { listingId, source } } });
  if (existing) return { feed: existing, created: false };
  const { data } = newToken(organizationId, listingId, source);
  const feed = await tx.channelFeed.create({ data: { organizationId, listingId, source, ...data } });
  return { feed, created: true };
}

/** Issues the export link of a home for a platform, or a new one in place of the current (the old one stops working). */
export async function issueExportLink(actor: Authorized, listingId: string, source: PlatformSource): Promise<{ token: string }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await homeOf(tx, organizationId, listingId);
    const { feed, created } = await ensureFeed(tx, organizationId, listingId, source);
    let token: string;
    if (created) token = decryptSecret(feed.exportTokenEnc, exportContext(organizationId, listingId, source));
    else {
      const t = newToken(organizationId, listingId, source);
      token = t.token;
      await tx.channelFeed.update({ where: { id: feed.id }, data: { ...t.data, exportRevokedAt: null, exportIssuedAt: new Date() } });
    }
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.export_link_issued", targetType: "listing", targetId: listingId, details: { source, regenerated: !created } });
    return { token };
  });
}

export async function revokeExportLink(actor: Authorized, listingId: string, source: PlatformSource): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await homeOf(tx, organizationId, listingId);
    const r = await tx.channelFeed.updateMany({ where: { organizationId, listingId, source, exportRevokedAt: null }, data: { exportRevokedAt: new Date() } });
    if (r.count === 0) throw new AppError(409, "NO_LINK", "Aucun lien d'export actif à révoquer.");
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.export_link_revoked", targetType: "listing", targetId: listingId, details: { source } });
  });
}

/**
 * Saves the platform's iCal link of a home (encrypted), to be read by the worker within the minute. Returns a warning
 * when the link's host isn't one of the platform's (saved all the same: platforms change domains).
 */
export async function setImportUrl(actor: Authorized, listingId: string, source: PlatformSource, rawUrl: string): Promise<{ warning: string | null; feedId: string }> {
  const { organizationId } = actor;
  const check = validateFeedUrl(rawUrl, { allowPrivate: allowPrivateFromEnv() });
  if (!check.ok) throw new AppError(422, "INVALID_URL", check.error);
  const p = platform(source);
  const host = check.url.hostname.toLowerCase().slice(0, 253);
  const warning = hostMatches(p, host) ? null : `Ce lien ne semble pas venir ${/^[aeiouy]/i.test(p.label) ? "d'" : "de "}${p.label} (${host}) : vérifiez qu'il est collé sur la bonne plateforme.`;
  return db.$transaction(async (tx) => {
    await homeOf(tx, organizationId, listingId);
    const { feed } = await ensureFeed(tx, organizationId, listingId, source);
    const now = new Date();
    await tx.channelFeed.update({
      where: { id: feed.id },
      data: {
        importUrlEnc: encryptSecret(check.url.toString(), importContext(organizationId, listingId, source)),
        importHost: host,
        importUrlSetAt: now,
        importEnabled: true,
        etag: null,
        lastModified: null,
        nextSyncAt: now,
        lastStatus: null,
        lastError: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        staleAlertedAt: null,
      },
    });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.import_url_set", targetType: "listing", targetId: listingId, details: { source, host, replaced: !!feed.importUrlEnc } });
    return { warning, feedId: feed.id };
  });
}

/** Stops reading the platform's link. The bookings it imported stay (they no longer follow the platform). */
export async function removeImportUrl(actor: Authorized, listingId: string, source: PlatformSource): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await homeOf(tx, organizationId, listingId);
    const r = await tx.channelFeed.updateMany({
      where: { organizationId, listingId, source, importUrlEnc: { not: null } },
      data: { importUrlEnc: null, importHost: null, importUrlSetAt: null, etag: null, lastModified: null, lastStatus: null, lastError: null, consecutiveFailures: 0, staleAlertedAt: null },
    });
    if (r.count === 0) throw new AppError(409, "NO_IMPORT", "Aucun lien d'import enregistré.");
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.import_url_removed", targetType: "listing", targetId: listingId, details: { source } });
  });
}

export const BOOKING_RULE_LIMITS = { preparationDays: 7, minNoticeDays: 30 } as const;

export async function saveBookingRules(actor: Authorized, listingId: string, input: { preparationDays: number; minNoticeDays: number }): Promise<void> {
  const { organizationId } = actor;
  const ok = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!ok(input.preparationDays, BOOKING_RULE_LIMITS.preparationDays)) throw new AppError(422, "INVALID_INPUT", "Délai de préparation : de 0 à 7 jours.");
  if (!ok(input.minNoticeDays, BOOKING_RULE_LIMITS.minNoticeDays)) throw new AppError(422, "INVALID_INPUT", "Préavis minimum : de 0 à 30 jours.");
  await db.$transaction(async (tx) => {
    const l = await tx.listing.findFirst({ where: { id: listingId, organizationId, category: "HOME" }, select: { preparationDays: true, minNoticeDays: true } });
    if (!l) throw listingNotFound();
    await tx.listing.update({ where: { id: listingId }, data: input });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "listing.booking_rules_updated",
      targetType: "listing",
      targetId: listingId,
      details: { from: { preparationDays: l.preparationDays, minNoticeDays: l.minNoticeDays }, to: input },
    });
  });
}

/** The decrypted import URL of a feed (the sync only). */
export function importUrlOf(feed: { organizationId: string; listingId: string; source: string; importUrlEnc: string | null }): string | null {
  return feed.importUrlEnc ? decryptSecret(feed.importUrlEnc, importContext(feed.organizationId, feed.listingId, feed.source)) : null;
}
