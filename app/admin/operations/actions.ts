"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { OPERATIONS_PATH } from "@/lib/admin/sections";
import { parseManualTaskForm, parseTaskTimeForm, TASK_LIMITS, taskFormValues, type TaskFieldErrors } from "@/lib/admin/task-form";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { assignTask, cancelTask, createManualTask, reopenTask, rescheduleTask, updateTaskNotes } from "@/lib/server/operations/tasks";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";

/**
 * Opérations (associés, ADMIN only): typing a task, assigning it, new day and times, notes, cancelling and
 * reopening. Every action checks the session, the role and double authentification again (requireAdminAction), and
 * only touches the caller's organization: ids come from the browser and are looked up within it (404 otherwise).
 * Rules and audit trail: lib/server/operations/tasks.ts.
 */

export interface TaskActionState {
  error?: string;
  fieldErrors?: TaskFieldErrors;
  values?: Record<string, string>;
  message?: string;
}

const NOT_FOUND = "Tâche introuvable.";
const validId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

export async function createTaskAction(_prev: TaskActionState, form: FormData): Promise<TaskActionState> {
  const access = await requireAdminAction(OPERATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  const values = taskFormValues(form);
  const parsed = parseManualTaskForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  let id: string;
  try {
    ({ id } = await createManualTask(access, parsed.input));
  } catch (e) {
    return { ...failure(e), values };
  }
  redirect(`/admin/operations/${id}?cree=1`);
}

export async function assignTaskAction(taskId: string, _prev: TaskActionState, form: FormData): Promise<TaskActionState> {
  const access = await requireAdminAction(OPERATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(taskId)) return { error: NOT_FOUND };
  const raw = form.get("assigneeId");
  const assigneeId = typeof raw === "string" && raw !== "" ? raw : null;
  if (assigneeId !== null && !ID_RE.test(assigneeId)) return { error: "Choisissez un membre de l'équipe dans la liste." };
  try {
    await assignTask(access, taskId, assigneeId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: assigneeId ? "Tâche affectée." : "Tâche désaffectée." };
}

export async function rescheduleTaskAction(taskId: string, _prev: TaskActionState, form: FormData): Promise<TaskActionState> {
  const access = await requireAdminAction(OPERATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(taskId)) return { error: NOT_FOUND };
  const parsed = parseTaskTimeForm(taskFormValues(form));
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors };
  try {
    await rescheduleTask(access, taskId, parsed.input);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Horaire enregistré." };
}

export async function updateTaskNotesAction(taskId: string, _prev: TaskActionState, form: FormData): Promise<TaskActionState> {
  const access = await requireAdminAction(OPERATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(taskId)) return { error: NOT_FOUND };
  const notes = String(form.get("notes") ?? "").trim();
  if (notes.length > TASK_LIMITS.notes || CONTROL_RE.test(notes)) return { error: `Consignes : ${TASK_LIMITS.notes} caractères au maximum, sans caractères spéciaux.` };
  try {
    await updateTaskNotes(access, taskId, notes);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Consignes enregistrées." };
}

export async function cancelTaskAction(taskId: string, _prev: TaskActionState, form: FormData): Promise<TaskActionState> {
  const access = await requireAdminAction(OPERATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(taskId)) return { error: NOT_FOUND };
  if (form.get("confirm") !== "on") return { error: "Cochez la case pour confirmer." };
  try {
    await cancelTask(access, taskId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Tâche annulée." };
}

export async function reopenTaskAction(taskId: string, _prev: TaskActionState, _form: FormData): Promise<TaskActionState> {
  void _form;
  const access = await requireAdminAction(OPERATIONS_PATH).catch(failure);
  if ("error" in access) return access;
  if (!validId(taskId)) return { error: NOT_FOUND };
  try {
    await reopenTask(access, taskId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Tâche remise « à faire »." };
}
