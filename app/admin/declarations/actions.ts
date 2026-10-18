"use server";

import { refresh } from "next/cache";
import { DECLARATIONS_PATH, MY_TASKS_PATH } from "@/lib/admin/sections";
import { travelerFormValues, type TravelerFieldErrors } from "@/lib/declarations/traveler-form";
import { requireAdminAction } from "@/lib/server/authz";
import { addTravelerDocument, deleteTraveler, deleteTravelerDocument, MAX_DOCUMENT_BYTES, saveTraveler, setDeclared, type CaptureScope } from "@/lib/server/declarations/travelers";
import { computeTaxNow, setTaxClosed } from "@/lib/server/declarations/tax";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Travellers' fiches (Lot 5). Every action checks the session, the role and double authentification again: from
 * Déclarations (scope { bookingId }) with the roles of /admin/declarations (associés); from a welcome task (scope
 * { taskId }) with those of /admin/mes-taches, then the task rule (lib/declarations/access.ts: an agent only for the
 * check-in assigned to them today or tomorrow). Rules, encryption and audit: lib/server/declarations/travelers.ts.
 */

export interface TravelerFormState {
  error?: string;
  message?: string;
  fieldErrors?: TravelerFieldErrors;
  values?: Record<string, string>;
  /** Bumped on success, to reset the form. */
  saved?: number;
}

export interface SimpleResult {
  error?: string;
  message?: string;
}

const ok = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** The scope as sent by the page, checked; and the section whose roles open it. */
function readScope(scope: unknown): { scope: CaptureScope; section: typeof DECLARATIONS_PATH } | null {
  if (typeof scope !== "object" || scope === null) return null;
  const s = scope as Record<string, unknown>;
  if (ok(s.taskId) && s.bookingId === undefined) return { scope: { taskId: s.taskId }, section: MY_TASKS_PATH };
  if (ok(s.bookingId) && s.taskId === undefined) return { scope: { bookingId: s.bookingId }, section: DECLARATIONS_PATH };
  return null;
}

const NOT_FOUND = "Réservation introuvable.";

async function documentBytes(form: FormData, field: string): Promise<Uint8Array | null | { error: string }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_DOCUMENT_BYTES) return { error: `Fichier trop lourd : ${MAX_DOCUMENT_BYTES / 1024 / 1024} Mo au maximum.` };
  return new Uint8Array(await file.arrayBuffer());
}

export async function saveTravelerAction(rawScope: unknown, travelerId: string | null, prev: TravelerFormState, form: FormData): Promise<TravelerFormState> {
  const s = readScope(rawScope);
  const access = await requireAdminAction(s?.section ?? DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!s || (travelerId !== null && !ok(travelerId))) return { error: NOT_FOUND };
  const values = travelerFormValues(form);
  const doc = travelerId === null ? await documentBytes(form, "document") : null;
  if (doc && "error" in doc) return { ...doc, values };
  try {
    const r = await saveTraveler(access, s.scope, travelerId, values, doc);
    if (!r.ok) return { error: "Corrigez les champs signalés.", fieldErrors: r.fieldErrors, values };
    refresh();
    if (r.documentError) return { error: `Fiche enregistrée, mais la photo n'a pas été ajoutée : ${r.documentError}`, saved: (prev.saved ?? 0) + 1 };
    return { message: travelerId ? "Fiche modifiée." : "Voyageur enregistré.", saved: (prev.saved ?? 0) + 1 };
  } catch (e) {
    return { ...failure(e), values };
  }
}

export async function deleteTravelerAction(rawScope: unknown, travelerId: string): Promise<SimpleResult> {
  const s = readScope(rawScope);
  const access = await requireAdminAction(s?.section ?? DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!s || !ok(travelerId)) return { error: NOT_FOUND };
  try {
    await deleteTraveler(access, s.scope, travelerId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Fiche supprimée." };
}

/** One photo or scan per call (recto, verso…), encrypted before storage. */
export async function uploadTravelerDocumentAction(rawScope: unknown, travelerId: string, form: FormData): Promise<SimpleResult> {
  const s = readScope(rawScope);
  const access = await requireAdminAction(s?.section ?? DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!s || !ok(travelerId)) return { error: NOT_FOUND };
  const doc = await documentBytes(form, "document");
  if (!doc) return { error: "Choisissez une photo de la pièce." };
  if ("error" in doc) return doc;
  try {
    await addTravelerDocument(access, s.scope, travelerId, doc);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo de la pièce ajoutée." };
}

export async function deleteTravelerDocumentAction(rawScope: unknown, documentId: string): Promise<SimpleResult> {
  const s = readScope(rawScope);
  const access = await requireAdminAction(s?.section ?? DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!s || !ok(documentId)) return { error: NOT_FOUND };
  try {
    await deleteTravelerDocument(access, s.scope, documentId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo supprimée." };
}

/** « Marquer comme déclaré » (télé-déclaration faite) or take it back, for every traveller of a stay. */
export async function setDeclaredAction(bookingId: string, declared: boolean): Promise<SimpleResult> {
  const access = await requireAdminAction(DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(bookingId)) return { error: NOT_FOUND };
  try {
    const n = await setDeclared(access, bookingId, declared === true);
    refresh();
    return { message: declared ? `Déclaration enregistrée (${n} voyageur${n > 1 ? "s" : ""}).` : "Déclaration annulée." };
  } catch (e) {
    return failure(e);
  }
}

export async function computeTaxAction(bookingId: string): Promise<SimpleResult> {
  const access = await requireAdminAction(DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(bookingId)) return { error: NOT_FOUND };
  try {
    await computeTaxNow(access, bookingId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Taxe de séjour calculée." };
}

export async function setTaxClosedAction(bookingId: string, closed: boolean): Promise<SimpleResult> {
  const access = await requireAdminAction(DECLARATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(bookingId)) return { error: NOT_FOUND };
  try {
    await setTaxClosed(access, bookingId, closed === true);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: closed ? "Taxe de séjour clôturée." : "Taxe de séjour rouverte." };
}
