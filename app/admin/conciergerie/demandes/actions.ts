"use server";

import { refresh } from "next/cache";
import { CONCIERGE_REQUESTS_PATH } from "@/lib/admin/sections";
import { PARTNER_CHANNELS } from "@/lib/concierge/catalog";
import { parseFinalPriceForm, parseInternalNote, parsePaymentMethod, type FieldErrors } from "@/lib/concierge/form";
import { formValues } from "@/lib/guide/form";
import type { PartnerChannel } from "@/lib/generated/prisma/enums";
import { requireAdminAction } from "@/lib/server/authz";
import { cancelPayment, markSent, recordPayment, setFinalPrice, setInternalNote, setRequestStatus } from "@/lib/server/concierge/requests";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Guests' service requests (Conciergerie → Demandes), associés only: every action checks the session, the role and
 * double authentification again (requireAdminAction(CONCIERGE_REQUESTS_PATH)) and only touches the caller's
 * organization; another organization's request is « Demande introuvable. » (lib/server/concierge/requests.ts, which
 * also writes the audit trail).
 */

export interface RequestActionState {
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
  message?: string;
}

const NOT_FOUND = "Demande introuvable.";
const valid = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);
const MOVES = ["CONFIRMED", "DONE", "CANCELLED", "REFUSED"] as const;
type Move = (typeof MOVES)[number];

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** Records the request as sent to the partner by `via` (after the associé opened the WhatsApp / e-mail link). */
export async function markSentAction(requestId: string, via: string): Promise<RequestActionState> {
  const a = await requireAdminAction(CONCIERGE_REQUESTS_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(requestId)) return { error: NOT_FOUND };
  if (!(PARTNER_CHANNELS as readonly string[]).includes(via)) return { error: "Choisissez WhatsApp, e-mail ou téléphone." };
  let delivered: boolean;
  try {
    ({ delivered } = await markSent(a, requestId, via as PartnerChannel));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: delivered ? "Message envoyé au partenaire." : "Demande marquée comme transmise au partenaire." };
}

export async function setRequestStatusAction(requestId: string, to: string): Promise<RequestActionState> {
  const a = await requireAdminAction(CONCIERGE_REQUESTS_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(requestId)) return { error: NOT_FOUND };
  if (!(MOVES as readonly string[]).includes(to)) return { error: "Statut inconnu." };
  try {
    await setRequestStatus(a, requestId, to as Move);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Statut enregistré." };
}

export async function setFinalPriceAction(requestId: string, _prev: RequestActionState, form: FormData): Promise<RequestActionState> {
  const a = await requireAdminAction(CONCIERGE_REQUESTS_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(requestId)) return { error: NOT_FOUND };
  const values = formValues(form);
  const parsed = parseFinalPriceForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await setFinalPrice(a, requestId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Prix final enregistré." };
}

export async function recordPaymentAction(requestId: string, _prev: RequestActionState, form: FormData): Promise<RequestActionState> {
  const a = await requireAdminAction(CONCIERGE_REQUESTS_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(requestId)) return { error: NOT_FOUND };
  const method = parsePaymentMethod(String(form.get("method") ?? ""));
  if (!method) return { error: "Moyen de paiement : choisissez dans la liste." };
  try {
    await recordPayment(a, requestId, method);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Paiement enregistré." };
}

export async function cancelPaymentAction(requestId: string): Promise<RequestActionState> {
  const a = await requireAdminAction(CONCIERGE_REQUESTS_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(requestId)) return { error: NOT_FOUND };
  try {
    await cancelPayment(a, requestId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Paiement retiré." };
}

export async function setInternalNoteAction(requestId: string, _prev: RequestActionState, form: FormData): Promise<RequestActionState> {
  const a = await requireAdminAction(CONCIERGE_REQUESTS_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(requestId)) return { error: NOT_FOUND };
  const parsed = parseInternalNote(String(form.get("internalNote") ?? ""));
  if (!parsed.ok) return { error: parsed.error };
  try {
    await setInternalNote(a, requestId, parsed.note);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Note enregistrée." };
}
