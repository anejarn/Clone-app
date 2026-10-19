"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { CONCIERGE_MANAGE_PATH } from "@/lib/admin/sections";
import { formValues } from "@/lib/guide/form";
import { parsePartnerForm, parseServiceForm, type FieldErrors } from "@/lib/concierge/form";
import { requireAdminAction } from "@/lib/server/authz";
import { createPartner, createService, deletePartner, deleteService, removeServicePhoto, setServicePhoto, updatePartner, updateService } from "@/lib/server/concierge/admin";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/**
 * Conciergerie catalogue (partners and services), associés only: every action checks the session, the role and double
 * authentification again (requireAdminAction(CONCIERGE_MANAGE_PATH), an ADMIN-only section) and only touches the
 * caller's organization (lib/server/concierge/admin.ts, which also writes the audit trail).
 */

export interface ConciergeFormState {
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
  message?: string;
}

const valid = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

const invalid = (fieldErrors: FieldErrors, values: Record<string, string>): ConciergeFormState => ({ error: "Corrigez les champs signalés.", fieldErrors, values });

export async function createPartnerAction(_prev: ConciergeFormState, form: FormData): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  const values = formValues(form);
  const parsed = parsePartnerForm({ ...values, active: "on" });
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await createPartner(a, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Partenaire ajouté." };
}

export async function updatePartnerAction(partnerId: string, _prev: ConciergeFormState, form: FormData): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(partnerId)) return { error: "Partenaire introuvable." };
  const values = formValues(form);
  const parsed = parsePartnerForm(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await updatePartner(a, partnerId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Partenaire enregistré." };
}

export async function deletePartnerAction(partnerId: string): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(partnerId)) return { error: "Partenaire introuvable." };
  try {
    await deletePartner(a, partnerId);
  } catch (e) {
    return failure(e);
  }
  redirect("/admin/conciergerie/gestion?supprime=1");
}

export async function createServiceAction(_prev: ConciergeFormState, form: FormData): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  const values = formValues(form);
  const parsed = parseServiceForm(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  let id: string;
  try {
    ({ id } = await createService(a, parsed.input));
  } catch (e) {
    return { ...failure(e), values };
  }
  redirect(`/admin/conciergerie/gestion/services/${id}?cree=1`);
}

export async function updateServiceAction(serviceId: string, _prev: ConciergeFormState, form: FormData): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(serviceId)) return { error: "Service introuvable." };
  const values = formValues(form);
  const parsed = parseServiceForm(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await updateService(a, serviceId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Service enregistré." };
}

export async function deleteServiceAction(serviceId: string): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(serviceId)) return { error: "Service introuvable." };
  try {
    await deleteService(a, serviceId);
  } catch (e) {
    return failure(e);
  }
  redirect("/admin/conciergerie?supprime=1");
}

/** One photo (field `photo`), replacing the current one. */
export async function setServicePhotoAction(serviceId: string, _prev: ConciergeFormState, form: FormData): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(serviceId)) return { error: "Service introuvable." };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez une photo." };
  if (file.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  try {
    await setServicePhoto(a, serviceId, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo enregistrée." };
}

export async function removeServicePhotoAction(serviceId: string): Promise<ConciergeFormState> {
  const a = await requireAdminAction(CONCIERGE_MANAGE_PATH).catch(failure);
  if ("error" in a) return a;
  if (!valid(serviceId)) return { error: "Service introuvable." };
  try {
    await removeServicePhoto(a, serviceId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Photo retirée." };
}
