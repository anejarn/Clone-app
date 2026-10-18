"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { TICKETS_PATH } from "@/lib/admin/sections";
import { parseComment, parseCostForm, parseNewTicketForm, parseStatusForm, ticketFormValues, type TicketFieldErrors } from "@/lib/admin/ticket-form";
import type { TicketPriority } from "@/lib/generated/prisma/enums";
import { TICKET_PRIORITIES } from "@/lib/operations/tickets";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { addTicketPhoto, assignTicket, commentTicket, createTicket, setTicketCost, setTicketPriority, setTicketStatus } from "@/lib/server/operations/tickets";
import { ID_RE } from "@/lib/server/schemas";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/**
 * Pannes (ADMIN and AGENT): reporting a breakdown, commenting, photos, moving it along; assigning it, its priority and
 * its cost are for associés. Every action checks the session, the role and double authentification again
 * (requireAdminAction), and only touches the caller's organization; a ticket the caller can't see is "Panne
 * introuvable." (lib/server/operations/tickets.ts, which also writes the thread and the audit trail).
 */

export interface TicketActionState {
  error?: string;
  fieldErrors?: TicketFieldErrors;
  values?: Record<string, string>;
  message?: string;
}

const NOT_FOUND = "Panne introuvable.";
const validId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

async function photoOf(form: FormData): Promise<{ bytes?: Uint8Array; error?: string }> {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return {};
  if (file.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  return { bytes: new Uint8Array(await file.arrayBuffer()) };
}

const NEW_FIELDS = ["listingId", "taskId", "title", "description", "category", "priority"] as const;

/** A new ticket (one optional photo, field `photo`), then its page. */
export async function createTicketAction(_prev: TicketActionState, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  const values = ticketFormValues(form, NEW_FIELDS);
  const parsed = parseNewTicketForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  const photo = await photoOf(form);
  if (photo.error) return { error: photo.error, values };
  let id: string;
  try {
    ({ id } = await createTicket(access, parsed.input, photo.bytes));
  } catch (e) {
    return { ...failure(e), values };
  }
  redirect(`/admin/pannes/${id}?cree=1`);
}

export async function commentTicketAction(ticketId: string, _prev: TicketActionState, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(ticketId)) return { error: NOT_FOUND };
  const parsed = parseComment(String(form.get("body") ?? ""));
  if (!parsed.ok) return { error: parsed.error };
  try {
    await commentTicket(access, ticketId, parsed.body);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Commentaire ajouté." };
}

export async function setTicketStatusAction(ticketId: string, _prev: TicketActionState, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(ticketId)) return { error: NOT_FOUND };
  const parsed = parseStatusForm(ticketFormValues(form, ["status", "waitingFor", "note"]));
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors };
  try {
    await setTicketStatus(access, ticketId, parsed.input);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Statut enregistré." };
}

export async function assignTicketAction(ticketId: string, _prev: TicketActionState, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(ticketId)) return { error: NOT_FOUND };
  const raw = form.get("assigneeId");
  const assigneeId = typeof raw === "string" && raw !== "" ? raw : null;
  if (assigneeId !== null && !ID_RE.test(assigneeId)) return { error: "Choisissez un membre de l'équipe dans la liste." };
  try {
    await assignTicket(access, ticketId, assigneeId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: assigneeId ? "Panne affectée." : "Panne désaffectée." };
}

export async function setTicketPriorityAction(ticketId: string, _prev: TicketActionState, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(ticketId)) return { error: NOT_FOUND };
  const priority = String(form.get("priority") ?? "");
  if (!(TICKET_PRIORITIES as string[]).includes(priority)) return { error: "Choisissez une priorité dans la liste." };
  try {
    await setTicketPriority(access, ticketId, priority as TicketPriority);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Priorité enregistrée." };
}

export async function setTicketCostAction(ticketId: string, _prev: TicketActionState, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(ticketId)) return { error: NOT_FOUND };
  const parsed = parseCostForm(ticketFormValues(form, ["cost", "rechargeOwner"]));
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors };
  try {
    await setTicketCost(access, ticketId, parsed.input);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Coût enregistré." };
}

/** One photo per call (field `photo`). */
export async function addTicketPhotoAction(ticketId: string, form: FormData): Promise<TicketActionState> {
  const access = await requireAdminAction(TICKETS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(ticketId)) return { error: NOT_FOUND };
  const photo = await photoOf(form);
  if (photo.error) return { error: photo.error };
  if (!photo.bytes) return { error: "Choisissez une photo." };
  try {
    await addTicketPhoto(access, ticketId, photo.bytes);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo ajoutée." };
}
