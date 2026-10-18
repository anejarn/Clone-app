import { z } from "zod";
import type { TaskType } from "@/lib/generated/prisma/enums";
import { TASK_TYPES } from "@/lib/operations/labels";
import { parseTimeOfDay } from "@/lib/operations/schedule";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";
import { parseDay } from "./calendar";

/**
 * Forms of Opérations (associés): a task typed by hand, a task's new day and times. Validated on the server by the
 * actions in app/admin/operations/actions.ts; rules that need the database (the home and the assignee belong to the
 * organization, the day isn't past in the home's time zone) are in lib/server/operations/tasks.ts.
 */

export const TASK_LIMITS = { title: 120, notes: 2000 } as const;

export interface TaskTimeInput {
  /** Local day (UTC midnight). */
  day: Date;
  /** Minutes after local midnight. */
  start: number;
  end: number;
}

export interface ManualTaskInput extends TaskTimeInput {
  listingId: string;
  type: TaskType;
  title: string;
  notes: string;
  assigneeId: string | null;
}

export type TaskFieldErrors = Partial<Record<"listingId" | "type" | "day" | "start" | "end" | "title" | "notes" | "assigneeId", string>>;

export type TaskFormResult<T> = { ok: true; input: T } | { ok: false; fieldErrors: TaskFieldErrors };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The form's fields as strings (anything else is ignored). */
export function taskFormValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["listingId", "type", "day", "start", "end", "title", "notes", "assigneeId"]) out[k] = str(form.get(k));
  return out;
}

const textField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au maximum`)
    .refine((s) => !CONTROL_RE.test(s), `${label} : caractères non autorisés`);

const timeSchema = z.object({
  day: z.string().transform((s, ctx) => parseDay(s.trim()) ?? (ctx.addIssue({ code: "custom", message: "Date : choisissez un jour" }), z.NEVER)),
  start: z.string().transform((s, ctx) => parseTimeOfDay(s) ?? (ctx.addIssue({ code: "custom", message: "Début : heure au format HH:MM" }), z.NEVER)),
  end: z.string().transform((s, ctx) => parseTimeOfDay(s) ?? (ctx.addIssue({ code: "custom", message: "Fin : heure au format HH:MM" }), z.NEVER)),
});

function errorsOf(issues: readonly { path: readonly PropertyKey[]; message: string }[]): TaskFieldErrors {
  const out: TaskFieldErrors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "day") as keyof TaskFieldErrors;
    out[k] ??= i.message;
  }
  return out;
}

function withOrder<T extends TaskTimeInput>(input: T): TaskFormResult<T> {
  if (input.end <= input.start) return { ok: false, fieldErrors: { end: "Fin : après l'heure de début" } };
  return { ok: true, input };
}

export function parseTaskTimeForm(values: Record<string, string>): TaskFormResult<TaskTimeInput> {
  const r = timeSchema.safeParse({ day: values.day ?? "", start: values.start ?? "", end: values.end ?? "" });
  return r.success ? withOrder(r.data) : { ok: false, fieldErrors: errorsOf(r.error.issues) };
}

const manualSchema = timeSchema.extend({
  listingId: z.string().trim().regex(ID_RE, "Bien : choisissez dans la liste"),
  type: z.enum(TASK_TYPES as [TaskType, ...TaskType[]], { message: "Type : choisissez dans la liste" }),
  title: textField("Titre", TASK_LIMITS.title),
  notes: textField("Consignes", TASK_LIMITS.notes),
  assigneeId: z
    .string()
    .trim()
    .refine((s) => s === "" || ID_RE.test(s), "Agent : choisissez dans la liste")
    .transform((s) => s || null),
});

/** A task typed by hand. An "Autre" task needs a title (the others are named by their type). */
export function parseManualTaskForm(values: Record<string, string>): TaskFormResult<ManualTaskInput> {
  const r = manualSchema.safeParse({
    listingId: values.listingId ?? "",
    type: values.type ?? "",
    day: values.day ?? "",
    start: values.start ?? "",
    end: values.end ?? "",
    title: values.title ?? "",
    notes: values.notes ?? "",
    assigneeId: values.assigneeId ?? "",
  });
  if (!r.success) return { ok: false, fieldErrors: errorsOf(r.error.issues) };
  if (r.data.type === "OTHER" && !r.data.title) return { ok: false, fieldErrors: { title: "Titre : obligatoire pour une tâche « Autre »" } };
  return withOrder(r.data);
}
