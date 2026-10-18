"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import {
  ENTRY_KINDS,
  entryFormValues,
  parseEntryForm,
  parseRescheduleForm,
  type EntryFieldErrors,
  type EntryKind,
  type EntryValues,
} from "@/lib/admin/booking-form";
import { BOOKING_ENTRY_PATH } from "@/lib/admin/sections";
import { TAGS } from "@/lib/data/repo";
import { cancelStaffBooking, createStaffEntry, rescheduleStaffBooking } from "@/lib/server/admin/bookings";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Réservations: typing a booking or an owner block, changing its dates, cancelling it. ADMIN only (the roles of
 * BOOKING_ENTRY_PATH, lib/admin/sections.ts): agents read the calendar and the bookings but don't write them. Every
 * action checks the session, the role and double authentification again (requireAdminAction), and only touches the
 * caller's organization: ids come from the browser and are looked up within it (404 otherwise). Rules, overlaps and
 * audit trail: lib/server/admin/bookings.ts.
 */

export interface EntryState {
  error?: string;
  fieldErrors?: EntryFieldErrors;
  /** The submitted values, to refill the form after an error. */
  values?: EntryValues;
}

export interface BookingActionState {
  error?: string;
  fieldErrors?: EntryFieldErrors;
  message?: string;
}

const NOT_FOUND = "Réservation introuvable.";

/** Refusals and rule violations become a message for the form; anything else is a real error. */
function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** The public site's availability (cached search and listing pages) follows every booking change. */
function changed() {
  updateTag(TAGS.availability);
}

export async function createEntryAction(kind: EntryKind, _prev: EntryState, form: FormData): Promise<EntryState> {
  const access = await requireAdminAction(BOOKING_ENTRY_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ENTRY_KINDS.includes(kind)) return { error: "Type de saisie inconnu." };
  const values = entryFormValues(form);
  const parsed = parseEntryForm(kind, values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  let id: string;
  try {
    ({ id } = await createStaffEntry(access, parsed.entry));
  } catch (e) {
    return { ...failure(e), values };
  }
  changed();
  redirect(`/admin/reservations/${id}?cree=${kind}`);
}

export async function rescheduleBookingAction(bookingId: string, _prev: BookingActionState, form: FormData): Promise<BookingActionState> {
  const access = await requireAdminAction(BOOKING_ENTRY_PATH).catch(failure);
  if ("error" in access) return access;
  if (typeof bookingId !== "string" || !ID_RE.test(bookingId)) return { error: NOT_FOUND };
  const parsed = parseRescheduleForm(entryFormValues(form));
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors };
  try {
    await rescheduleStaffBooking(access, bookingId, parsed.input);
  } catch (e) {
    return failure(e);
  }
  changed();
  refresh();
  return { message: "Dates modifiées." };
}

export async function cancelBookingAction(bookingId: string, _prev: BookingActionState, form: FormData): Promise<BookingActionState> {
  const access = await requireAdminAction(BOOKING_ENTRY_PATH).catch(failure);
  if ("error" in access) return access;
  if (typeof bookingId !== "string" || !ID_RE.test(bookingId)) return { error: NOT_FOUND };
  if (form.get("confirm") !== "on") return { error: "Cochez la case pour confirmer." };
  let source: string;
  try {
    ({ source } = await cancelStaffBooking(access, bookingId));
  } catch (e) {
    return failure(e);
  }
  changed();
  refresh();
  return {
    message:
      source === "OWNER"
        ? "Blocage levé : les dates sont de nouveau libres."
        : source === "DIRECT"
          ? "Réservation annulée : les dates sont de nouveau libres."
          : "Réservation annulée dans Sigma. Annulez-la aussi sur la plateforme.",
  };
}
