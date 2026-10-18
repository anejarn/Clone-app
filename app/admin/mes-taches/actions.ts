"use server";

import { refresh } from "next/cache";
import { MY_TASKS_PATH } from "@/lib/admin/sections";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { addTaskPhoto, completeTask, deleteTaskPhoto, setItemChecked, startTask } from "@/lib/server/operations/tasks";
import { revealTaskSecrets, type RevealedSecrets } from "@/lib/server/guide/admin";
import { ID_RE } from "@/lib/server/schemas";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/**
 * Mes tâches (ADMIN and AGENT): working on a task — start it, tick its items, add or remove photos, finish it.
 * Every action checks the session, the role and double authentification again (requireAdminAction); an agent only
 * reaches the tasks assigned to them, an associé every task of the organization (lib/server/operations/tasks.ts):
 * anything else is "Tâche introuvable.". Small actions, one change each, so the page can later queue them while
 * offline (Ma journée).
 */

export interface WorkResult {
  error?: string;
  message?: string;
}

const NOT_FOUND = "Tâche introuvable.";
const validIds = (...ids: unknown[]) => ids.every((id) => typeof id === "string" && ID_RE.test(id));

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

async function run(fn: () => Promise<unknown>, message?: string): Promise<WorkResult> {
  try {
    await fn();
  } catch (e) {
    return failure(e);
  }
  refresh();
  return message ? { message } : {};
}

export async function startTaskAction(taskId: string): Promise<WorkResult> {
  const access = await requireAdminAction(MY_TASKS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validIds(taskId)) return { error: NOT_FOUND };
  return run(() => startTask(access, taskId), "Tâche commencée.");
}

export async function toggleItemAction(taskId: string, itemId: string, checked: boolean): Promise<WorkResult> {
  const access = await requireAdminAction(MY_TASKS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validIds(taskId, itemId)) return { error: NOT_FOUND };
  return run(() => setItemChecked(access, taskId, itemId, checked === true));
}

/** One photo per call, for one item. */
export async function uploadTaskPhotoAction(taskId: string, itemId: string, form: FormData): Promise<WorkResult> {
  const access = await requireAdminAction(MY_TASKS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validIds(taskId, itemId)) return { error: NOT_FOUND };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez une photo." };
  if (file.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return run(() => addTaskPhoto(access, taskId, itemId, bytes), "Photo ajoutée.");
}

export async function deleteTaskPhotoAction(taskId: string, photoId: string): Promise<WorkResult> {
  const access = await requireAdminAction(MY_TASKS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validIds(taskId, photoId)) return { error: NOT_FOUND };
  return run(() => deleteTaskPhoto(access, taskId, photoId), "Photo supprimée.");
}

export async function completeTaskAction(taskId: string): Promise<WorkResult> {
  const access = await requireAdminAction(MY_TASKS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validIds(taskId)) return { error: NOT_FOUND };
  return run(() => completeTask(access, taskId), "Tâche terminée. Merci !");
}

/**
 * The access codes and Wi-Fi password of the task's home, shown to whoever does the task (audited « guide.secrets_revealed »):
 * an agent only for a task assigned to them today or tomorrow, neither cancelled nor done; an associé for any task
 * that isn't cancelled (lib/server/guide/admin.ts, canRevealForTask). Never kept on the phone.
 */
export async function revealTaskCodesAction(taskId: string): Promise<{ error?: string; secrets?: RevealedSecrets }> {
  const access = await requireAdminAction(MY_TASKS_PATH).catch(failure);
  if ("error" in access) return access;
  if (typeof taskId !== "string" || !ID_RE.test(taskId)) return { error: "Tâche introuvable." };
  try {
    return { secrets: await revealTaskSecrets(access, taskId) };
  } catch (e) {
    return failure(e);
  }
}
