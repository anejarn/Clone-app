"use server";

import { refresh } from "next/cache";
import { BOOKING_ENTRY_PATH } from "@/lib/admin/sections";
import { isGuestLocale } from "@/lib/i18n/locales";
import { issueGuideLink, revokeGuideLink, setGuestLocale } from "@/lib/server/guide/admin";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * The secret link of a stay's welcome guide (Réservations → a booking), ADMIN only (the roles of
 * BOOKING_ENTRY_PATH): issue or regenerate it (the old link stops working), revoke it, set the guest's language.
 * Rules and audit trail: lib/server/guide/admin.ts. The booking page then shows the link (copy, WhatsApp).
 */

export interface GuideLinkState {
  error?: string;
  message?: string;
}

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

const NOT_FOUND = { error: "Réservation introuvable." };

export async function issueGuideLinkAction(bookingId: string): Promise<GuideLinkState> {
  const a = await requireAdminAction(BOOKING_ENTRY_PATH).catch(failure);
  if ("error" in a) return a;
  if (typeof bookingId !== "string" || !ID_RE.test(bookingId)) return NOT_FOUND;
  try {
    const { regenerated } = await issueGuideLink(a, bookingId);
    refresh();
    return { message: regenerated ? "Nouveau lien créé : l'ancien ne fonctionne plus." : "Lien du guide créé." };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeGuideLinkAction(bookingId: string): Promise<GuideLinkState> {
  const a = await requireAdminAction(BOOKING_ENTRY_PATH).catch(failure);
  if ("error" in a) return a;
  if (typeof bookingId !== "string" || !ID_RE.test(bookingId)) return NOT_FOUND;
  try {
    await revokeGuideLink(a, bookingId);
    refresh();
    return { message: "Lien révoqué : le guide n'est plus accessible." };
  } catch (e) {
    return failure(e);
  }
}

export async function setGuestLocaleAction(bookingId: string, _prev: GuideLinkState, form: FormData): Promise<GuideLinkState> {
  const a = await requireAdminAction(BOOKING_ENTRY_PATH).catch(failure);
  if ("error" in a) return a;
  if (typeof bookingId !== "string" || !ID_RE.test(bookingId)) return NOT_FOUND;
  const raw = String(form.get("guestLocale") ?? "");
  if (raw !== "" && !isGuestLocale(raw)) return { error: "Langue inconnue." };
  try {
    await setGuestLocale(a, bookingId, raw === "" ? null : raw);
    refresh();
    return { message: "Langue enregistrée." };
  } catch (e) {
    return failure(e);
  }
}
