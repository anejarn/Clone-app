"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { listingFormValues, parseListingForm, type FieldErrors } from "@/lib/admin/listing-form";
import { TAGS } from "@/lib/data/repo";
import {
  addListingPhoto,
  createAdminListing,
  deleteListingPhoto,
  moveListingPhoto,
  updateAdminListing,
  type PhotoMove,
} from "@/lib/server/admin/listings";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/**
 * Biens (ADMIN only). Every action checks the session, the role and double authentification again
 * (requireAdminAction), and only touches the caller's organization: the ids it receives come from the browser
 * and are looked up within that organization (404 otherwise).
 */

export interface FormState {
  error?: string;
  fieldErrors?: FieldErrors;
  /** The submitted values, to refill the form after an error. */
  values?: Record<string, unknown>;
  saved?: boolean;
}

export interface ActionResult {
  error?: string;
}

const NOT_FOUND = "Bien introuvable.";

/** Refusals and rule violations become a message for the form; anything else is a real error. */
function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** The public catalogue (cached homepage rows) shows listings: refresh it after any change. */
function changed() {
  updateTag(TAGS.listings);
}

export async function createListingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const access = await requireAdminAction("/admin/biens").catch(failure);
  if ("error" in access) return access;
  const { organizationId } = access;
  const values = listingFormValues(form);
  const parsed = parseListingForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  let id: string;
  try {
    ({ id } = await createAdminListing(organizationId, parsed.input));
  } catch (e) {
    return { ...failure(e), values };
  }
  changed();
  redirect(`/admin/biens/${id}?cree=1`);
}

export async function updateListingAction(listingId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const access = await requireAdminAction("/admin/biens").catch(failure);
  if ("error" in access) return access;
  const { organizationId } = access;
  if (typeof listingId !== "string" || !ID_RE.test(listingId)) return { error: NOT_FOUND };
  const values = listingFormValues(form);
  const parsed = parseListingForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await updateAdminListing(organizationId, listingId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  changed();
  redirect(`/admin/biens/${listingId}?modifie=1`);
}

/** One photo per call (the form sends the selected files one after the other). */
export async function uploadPhotoAction(listingId: string, form: FormData): Promise<ActionResult> {
  const access = await requireAdminAction("/admin/biens").catch(failure);
  if ("error" in access) return access;
  const { organizationId } = access;
  if (typeof listingId !== "string" || !ID_RE.test(listingId)) return { error: NOT_FOUND };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez une photo." };
  if (file.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  try {
    await addListingPhoto(organizationId, listingId, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return failure(e);
  }
  changed();
  refresh();
  return {};
}

export async function deletePhotoAction(listingId: string, photoId: string): Promise<ActionResult> {
  const access = await requireAdminAction("/admin/biens").catch(failure);
  if ("error" in access) return access;
  const { organizationId } = access;
  if (![listingId, photoId].every((id) => typeof id === "string" && ID_RE.test(id))) return { error: NOT_FOUND };
  try {
    await deleteListingPhoto(organizationId, listingId, photoId);
  } catch (e) {
    return failure(e);
  }
  changed();
  refresh();
  return {};
}

const MOVES: readonly PhotoMove[] = ["cover", "up", "down"];

export async function movePhotoAction(listingId: string, photoId: string, move: PhotoMove): Promise<ActionResult> {
  const access = await requireAdminAction("/admin/biens").catch(failure);
  if ("error" in access) return access;
  const { organizationId } = access;
  if (![listingId, photoId].every((id) => typeof id === "string" && ID_RE.test(id))) return { error: NOT_FOUND };
  if (!MOVES.includes(move)) return { error: "Déplacement inconnu." };
  try {
    await moveListingPhoto(organizationId, listingId, photoId, move);
  } catch (e) {
    return failure(e);
  }
  changed();
  refresh();
  return {};
}
