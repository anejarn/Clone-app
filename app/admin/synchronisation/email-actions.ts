"use server";

import { refresh, updateTag } from "next/cache";
import { entryFormValues, parseEntryForm, type EntryFieldErrors, type EntryValues } from "@/lib/admin/booking-form";
import { emailResultText } from "@/lib/admin/emails";
import { SYNC_PATH } from "@/lib/admin/sections";
import { TAGS } from "@/lib/data/repo";
import { requireAdminAction } from "@/lib/server/authz";
import { issueInboundAddress, revokeInboundAddress } from "@/lib/server/channels/email/address";
import { MAX_EMAIL_BYTES, ingestInboundEmail } from "@/lib/server/channels/email/process";
import { applyPendingEmail, createBookingFromEmail, ignoreEmail } from "@/lib/server/channels/email/queue";
import { markPriceReminderDone } from "@/lib/server/channels/price-reminders";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Synchronisation → E-mails à traiter and Prix à reporter (Lot 7b), ADMIN only: every action checks the session, the
 * role and double authentification again (requireAdminAction(SYNC_PATH)) and only touches the caller's organization
 * (another organization's message or reminder: « introuvable »). Rules: lib/server/channels/email/ and
 * lib/server/channels/price-reminders.ts.
 */

export interface EmailActionState {
  error?: string;
  message?: string;
  fieldErrors?: EntryFieldErrors;
  values?: EntryValues;
  emailId?: string;
  bookingId?: string | null;
  status?: string;
}

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

const checkId = (id: unknown, what = "E-mail introuvable.") => {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new AppError(404, "NOT_FOUND", what);
};

/** « Déposer un e-mail »: a .eml file or the message pasted (headers included), processed like a received one. */
export async function dropEmailAction(_prev: EmailActionState, form: FormData): Promise<EmailActionState> {
  let state: EmailActionState;
  try {
    const a = await requireAdminAction(SYNC_PATH);
    const file = form.get("eml");
    const pasted = form.get("raw");
    let raw: Uint8Array | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_EMAIL_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Fichier trop lourd : 5 Mo au maximum.");
      raw = new Uint8Array(await file.arrayBuffer());
    } else if (typeof pasted === "string" && pasted.trim()) {
      raw = new TextEncoder().encode(pasted.replace(/^\s+/, ""));
      if (raw.byteLength > MAX_EMAIL_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Message trop long : 5 Mo au maximum.");
    }
    if (!raw) throw new AppError(422, "EMPTY", "Choisissez un fichier .eml ou collez le message complet (avec ses en-têtes).");
    const r = await ingestInboundEmail({ organizationId: a.organizationId, raw, via: "MANUAL", actorId: a.user.id });
    state = { message: emailResultText(r), emailId: r.id, bookingId: r.bookingId, status: r.status };
  } catch (e) {
    return failure(e);
  }
  updateTag(TAGS.availability);
  refresh();
  return state;
}

/** Applies a waiting e-mail again: with the home chosen (and remembered), or trusting it. */
export async function applyEmailAction(emailId: string, _prev: EmailActionState, form: FormData): Promise<EmailActionState> {
  let state: EmailActionState;
  try {
    const a = await requireAdminAction(SYNC_PATH);
    checkId(emailId);
    const listingId = String(form.get("listingId") ?? "").trim();
    if (listingId) checkId(listingId, "Bien introuvable.");
    const r = await applyPendingEmail(a, emailId, { listingId: listingId || undefined, remember: form.get("remember") === "on" });
    if (r.status === "PENDING") return { error: emailResultText({ ...r, outcome: null }) };
    state = { message: emailResultText(r), bookingId: r.bookingId, status: r.status };
  } catch (e) {
    return failure(e);
  }
  updateTag(TAGS.availability);
  refresh();
  return state;
}

/** Creates the booking by hand from a waiting e-mail (the platform entry of Réservations). */
export async function createBookingFromEmailAction(emailId: string, _prev: EmailActionState, form: FormData): Promise<EmailActionState> {
  const values = entryFormValues(form);
  let state: EmailActionState;
  try {
    const a = await requireAdminAction(SYNC_PATH);
    checkId(emailId);
    const parsed = parseEntryForm("plateforme", values);
    if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
    if (parsed.entry.kind !== "plateforme") throw new AppError(422, "INVALID_INPUT", "Saisie invalide.");
    const r = await createBookingFromEmail(a, emailId, parsed.entry);
    state = { message: "Réservation créée : les dates sont bloquées.", bookingId: r.bookingId, status: "PROCESSED" };
  } catch (e) {
    return { ...failure(e), values };
  }
  updateTag(TAGS.availability);
  refresh();
  return state;
}

export async function ignoreEmailAction(emailId: string): Promise<EmailActionState> {
  try {
    const a = await requireAdminAction(SYNC_PATH);
    checkId(emailId);
    await ignoreEmail(a, emailId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "E-mail ignoré." };
}

export async function issueInboundAddressAction(): Promise<EmailActionState> {
  try {
    await issueInboundAddress(await requireAdminAction(SYNC_PATH));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Adresse de réception créée. Donnez-la au service de réception d'e-mails (à choisir) ; l'ancienne, s'il y en avait une, ne fonctionne plus." };
}

export async function revokeInboundAddressAction(): Promise<EmailActionState> {
  try {
    await revokeInboundAddress(await requireAdminAction(SYNC_PATH));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Adresse de réception révoquée : plus aucun e-mail n'est accepté." };
}

/** « Fait » on a price reminder: the change was reported on that platform. */
export async function markPriceReminderDoneAction(reminderId: string): Promise<EmailActionState> {
  try {
    const a = await requireAdminAction(SYNC_PATH);
    checkId(reminderId, "Rappel introuvable.");
    await markPriceReminderDone(a, reminderId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Marqué comme fait." };
}
