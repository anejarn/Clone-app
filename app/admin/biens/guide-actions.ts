"use server";

import { refresh } from "next/cache";
import {
  formValues,
  parseAccessCode,
  parseConcierge,
  parseGuideTexts,
  parseRecommendation,
  parseWifi,
  GUIDE_LIMITS,
  type GuideFieldErrors,
} from "@/lib/guide/form";
import {
  addAccessCode,
  addGuidePhoto,
  addRecommendation,
  deleteAccessCode,
  deleteGuidePhoto,
  deleteRecommendation,
  revealListingSecrets,
  saveConcierge,
  saveGuideTexts,
  saveWifi,
  updateAccessCode,
  updateRecommendation,
  type RevealedSecrets,
} from "@/lib/server/guide/admin";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/**
 * Welcome guide in the back-office (Biens → Guide d'accueil, and « Guide : réglages communs »), ADMIN only: every
 * action checks the session, the role and double authentification again (requireAdminAction("/admin/biens")) and
 * only touches the caller's organization. Rules, encryption and audit trail: lib/server/guide/admin.ts.
 */

export interface GuideFormState {
  error?: string;
  fieldErrors?: GuideFieldErrors;
  values?: Record<string, string>;
  message?: string;
}

export interface RevealState {
  error?: string;
  secrets?: RevealedSecrets;
}

const PATH = "/admin/biens";
const ok = (id: unknown) => typeof id === "string" && ID_RE.test(id);

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

const invalid = (fieldErrors: GuideFieldErrors, values: Record<string, string>): GuideFormState => ({ error: "Corrigez les champs signalés.", fieldErrors, values });

export async function saveGuideTextsAction(listingId: string, _prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId)) return { error: "Bien introuvable." };
  const values = formValues(form);
  const parsed = parseGuideTexts(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await saveGuideTexts(a, listingId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Guide enregistré." };
}

export async function saveWifiAction(listingId: string, _prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId)) return { error: "Bien introuvable." };
  const values = formValues(form);
  const parsed = parseWifi(values);
  // The password is never sent back to the browser, even after an error.
  const { wifiPassword: _p, ...safe } = values;
  void _p;
  if (!parsed.ok) return invalid(parsed.fieldErrors, safe);
  try {
    await saveWifi(a, listingId, parsed.input);
  } catch (e) {
    return { ...failure(e), values: safe };
  }
  refresh();
  return { message: "Wi-Fi enregistré." };
}

export async function addCodeAction(listingId: string, _prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId)) return { error: "Bien introuvable." };
  const values = formValues(form);
  const parsed = parseAccessCode(values, { requireValue: true });
  const { value: _v, ...safe } = values;
  void _v;
  if (!parsed.ok) return invalid(parsed.fieldErrors, safe);
  try {
    await addAccessCode(a, listingId, parsed.input);
  } catch (e) {
    return { ...failure(e), values: safe };
  }
  refresh();
  return { message: "Code ajouté." };
}

export async function updateCodeAction(listingId: string, codeId: string, _prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId) || !ok(codeId)) return { error: "Code introuvable." };
  const values = formValues(form);
  const parsed = parseAccessCode(values, { requireValue: false });
  const { value: _v, ...safe } = values;
  void _v;
  if (!parsed.ok) return invalid(parsed.fieldErrors, safe);
  try {
    await updateAccessCode(a, listingId, codeId, parsed.input);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Code modifié." };
}

export async function deleteCodeAction(listingId: string, codeId: string): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId) || !ok(codeId)) return { error: "Code introuvable." };
  try {
    await deleteAccessCode(a, listingId, codeId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Code supprimé." };
}

/** Shows the home's codes and Wi-Fi password in clear to the associé (audited). */
export async function revealSecretsAction(listingId: string): Promise<RevealState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId)) return { error: "Bien introuvable." };
  try {
    return { secrets: await revealListingSecrets(a, listingId) };
  } catch (e) {
    return failure(e);
  }
}

export async function uploadGuidePhotoAction(listingId: string, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId)) return { error: "Bien introuvable." };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez une photo." };
  if (file.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  const caption = String(form.get("caption") ?? "").trim().slice(0, GUIDE_LIMITS.photoCaption);
  try {
    await addGuidePhoto(a, listingId, new Uint8Array(await file.arrayBuffer()), caption);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo ajoutée." };
}

export async function deleteGuidePhotoAction(listingId: string, photoId: string): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(listingId) || !ok(photoId)) return { error: "Photo introuvable." };
  try {
    await deleteGuidePhoto(a, listingId, photoId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo supprimée." };
}

/** listingId null: one of the organization's default recommendations. */
export async function addRecommendationAction(listingId: string | null, _prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (listingId !== null && !ok(listingId)) return { error: "Bien introuvable." };
  const values = formValues(form);
  const parsed = parseRecommendation(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await addRecommendation(a, listingId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Recommandation ajoutée." };
}

export async function updateRecommendationAction(id: string, _prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(id)) return { error: "Recommandation introuvable." };
  const values = formValues(form);
  const parsed = parseRecommendation(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await updateRecommendation(a, id, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Recommandation modifiée." };
}

export async function deleteRecommendationAction(id: string): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  if (!ok(id)) return { error: "Recommandation introuvable." };
  try {
    await deleteRecommendation(a, id);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Recommandation supprimée." };
}

export async function saveConciergeAction(_prev: GuideFormState, form: FormData): Promise<GuideFormState> {
  const a = await requireAdminAction(PATH).catch(failure);
  if ("error" in a) return a;
  const values = formValues(form);
  const parsed = parseConcierge(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await saveConcierge(a, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Contact de la conciergerie enregistré." };
}
