"use server";

import { refresh, updateTag } from "next/cache";
import { SYNC_PATH } from "@/lib/admin/sections";
import { TAGS } from "@/lib/data/repo";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminAction } from "@/lib/server/authz";
import { issueExportLink, parseSource, removeImportUrl, revokeExportLink, saveBookingRules, setImportUrl } from "@/lib/server/channels/feeds";
import { orgFeed } from "@/lib/server/channels/conflicts";
import { syncFeed } from "@/lib/server/channels/sync";
import { db } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Biens → a home → Plateformes (Lot 7), ADMIN only: every action checks the session, the role and double
 * authentification again and only touches the caller's organization (another organization's home: « introuvable »).
 * Rules, encryption and audit: lib/server/channels/feeds.ts; the read itself: lib/server/channels/sync.ts.
 */

export interface ChannelFormState {
  error?: string;
  message?: string;
  warning?: string;
}

const PATH = "/admin/biens";

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

function checkIds(listingId: unknown) {
  if (typeof listingId !== "string" || !ID_RE.test(listingId)) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
}

export async function issueExportLinkAction(listingId: string, source: string): Promise<ChannelFormState> {
  try {
    const a = await requireAdminAction(PATH);
    checkIds(listingId);
    await issueExportLink(a, listingId, parseSource(source));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Lien d'export créé. Collez-le dans l'import de calendrier de la plateforme." };
}

export async function revokeExportLinkAction(listingId: string, source: string): Promise<ChannelFormState> {
  try {
    const a = await requireAdminAction(PATH);
    checkIds(listingId);
    await revokeExportLink(a, listingId, parseSource(source));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Lien d'export révoqué : la plateforme ne reçoit plus les dates de Sigma." };
}

export async function setImportUrlAction(listingId: string, source: string, _prev: ChannelFormState, form: FormData): Promise<ChannelFormState> {
  let warning: string | null;
  try {
    const a = await requireAdminAction(PATH);
    checkIds(listingId);
    ({ warning } = await setImportUrl(a, listingId, parseSource(source), String(form.get("url") ?? "")));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Lien enregistré : il sera lu dans la minute (ou cliquez sur « Synchroniser maintenant »).", ...(warning && { warning }) };
}

export async function removeImportUrlAction(listingId: string, source: string): Promise<ChannelFormState> {
  try {
    const a = await requireAdminAction(PATH);
    checkIds(listingId);
    await removeImportUrl(a, listingId, parseSource(source));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Lien d'import supprimé. Les réservations déjà importées restent." };
}

export async function saveBookingRulesAction(listingId: string, _prev: ChannelFormState, form: FormData): Promise<ChannelFormState> {
  try {
    const a = await requireAdminAction(PATH);
    checkIds(listingId);
    const n = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return /^\d{1,2}$/.test(v) ? Number(v) : NaN;
    };
    await saveBookingRules(a, listingId, { preparationDays: n("preparationDays"), minNoticeDays: n("minNoticeDays") });
  } catch (e) {
    return failure(e);
  }
  updateTag(TAGS.availability);
  refresh();
  return { message: "Règles enregistrées. Reportez-les aussi dans les paramètres de chaque plateforme." };
}

/** « Synchroniser maintenant »: reads the platform's link at once, under the same lock as the worker. */
export async function syncNowAction(listingId: string, source: string): Promise<ChannelFormState> {
  let text: string;
  try {
    const a = await requireAdminAction(SYNC_PATH);
    checkIds(listingId);
    const feed = await orgFeed(a.organizationId, listingId, parseSource(source));
    if (!feed?.importUrlEnc) throw new AppError(404, "NOT_FOUND", "Aucun lien d'import pour cette plateforme.");
    await db.$transaction((tx) =>
      recordAudit(tx, { organizationId: a.organizationId, actorId: a.user.id, action: "channel.sync_requested", targetType: "channel_feed", targetId: feed.id, details: { listingId, source } }),
    );
    const r = await syncFeed(feed.id, { trigger: "MANUAL", actorId: a.user.id });
    if (r.skipped) return { error: r.errorMessage ?? "Lecture déjà en cours." };
    if (r.outcome === "ERROR") {
      refresh();
      return { error: `Lecture impossible : ${r.errorMessage}` };
    }
    text =
      r.outcome === "NOT_MODIFIED"
        ? "Calendrier lu : rien n'a changé depuis la dernière lecture."
        : `Calendrier lu : ${r.eventsSeen} événement(s), ${r.created} créée(s), ${r.updated} modifiée(s), ${r.cancelled} annulée(s), ${r.conflicts} conflit(s).`;
  } catch (e) {
    return failure(e);
  }
  updateTag(TAGS.availability);
  refresh();
  return { message: text };
}
