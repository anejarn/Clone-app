import { z } from "zod";
import { dirhamsToCentimes } from "@/lib/money";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_WAITING,
  type TicketCategoryKey,
  type TicketPriorityKey,
  type TicketStatusKey,
  type TicketWaitingKey,
} from "@/lib/operations/tickets";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";

/**
 * Forms of Pannes (breakdown reports), validated on the server by app/admin/pannes/actions.ts. Rules that need the
 * database (the home, the task and the assignee belong to the organization, who may change what) are in
 * lib/server/operations/tickets.ts.
 */

export const TICKET_LIMITS = { title: 120, description: 4000, comment: 4000 } as const;
/** 1 000 000 MAD, in centimes (tickets_cost_check). */
export const MAX_TICKET_COST_CENTS = 100_000_000;

export interface NewTicketInput {
  /** The home, or null when the ticket comes from a task (the task's home is used). */
  listingId: string | null;
  taskId: string | null;
  title: string;
  description: string;
  category: TicketCategoryKey;
  priority: TicketPriorityKey;
}

export type TicketFieldErrors = Partial<Record<"listingId" | "taskId" | "title" | "description" | "category" | "priority" | "status" | "waitingFor" | "cost" | "body", string>>;
export type TicketFormResult<T> = { ok: true; input: T } | { ok: false; fieldErrors: TicketFieldErrors };

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function ticketFormValues(form: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, str(form.get(k))]));
}

const textField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au maximum`)
    .refine((s) => !CONTROL_RE.test(s), `${label} : caractères non autorisés`);

const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .refine((s) => s === "" || ID_RE.test(s), message)
    .transform((s) => s || null);

function errorsOf(issues: readonly { path: readonly PropertyKey[]; message: string }[]): TicketFieldErrors {
  const out: TicketFieldErrors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "title") as keyof TicketFieldErrors;
    out[k] ??= i.message;
  }
  return out;
}

const newSchema = z.object({
  listingId: optionalId("Bien : choisissez dans la liste"),
  taskId: optionalId("Tâche introuvable"),
  title: textField("Titre", TICKET_LIMITS.title).refine((s) => s.length > 0, "Titre : décrivez la panne en quelques mots"),
  description: textField("Description", TICKET_LIMITS.description),
  category: z.enum(TICKET_CATEGORIES as [TicketCategoryKey, ...TicketCategoryKey[]], { message: "Catégorie : choisissez dans la liste" }),
  priority: z.enum(TICKET_PRIORITIES as [TicketPriorityKey, ...TicketPriorityKey[]], { message: "Priorité : choisissez dans la liste" }),
});

/** A new ticket: a home (or a task, which gives the home), a title, a category and a priority. */
export function parseNewTicketForm(values: Record<string, string>): TicketFormResult<NewTicketInput> {
  const r = newSchema.safeParse({
    listingId: values.listingId ?? "",
    taskId: values.taskId ?? "",
    title: values.title ?? "",
    description: values.description ?? "",
    category: values.category ?? "",
    priority: values.priority || "NORMAL",
  });
  if (!r.success) return { ok: false, fieldErrors: errorsOf(r.error.issues) };
  if (!r.data.listingId && !r.data.taskId) return { ok: false, fieldErrors: { listingId: "Bien : choisissez dans la liste" } };
  return { ok: true, input: r.data };
}

export interface StatusInput {
  status: TicketStatusKey;
  waitingFor: TicketWaitingKey | null;
  /** Optional note added to the thread with the change. */
  note: string;
}

const statusSchema = z.object({
  status: z.enum(TICKET_STATUSES as [TicketStatusKey, ...TicketStatusKey[]], { message: "Statut : choisissez dans la liste" }),
  waitingFor: z
    .string()
    .refine((s) => s === "" || (TICKET_WAITING as string[]).includes(s), "En attente : choisissez dans la liste")
    .transform((s) => (s || null) as TicketWaitingKey | null),
  note: textField("Note", TICKET_LIMITS.comment),
});

export function parseStatusForm(values: Record<string, string>): TicketFormResult<StatusInput> {
  const r = statusSchema.safeParse({ status: values.status ?? "", waitingFor: values.waitingFor ?? "", note: values.note ?? "" });
  if (!r.success) return { ok: false, fieldErrors: errorsOf(r.error.issues) };
  if (r.data.status === "WAITING" && !r.data.waitingFor) return { ok: false, fieldErrors: { waitingFor: "En attente : d'une pièce ou d'un prestataire ?" } };
  return { ok: true, input: { ...r.data, waitingFor: r.data.status === "WAITING" ? r.data.waitingFor : null } };
}

export interface CostInput {
  /** Centimes of dirham; null = no cost known. */
  costCents: number | null;
  rechargeOwner: boolean;
}

/** The repair's cost typed in dirhams ("1 250,50"), and whether to re-invoice the owner (needs a cost). */
export function parseCostForm(values: Record<string, string>): TicketFormResult<CostInput> {
  const raw = (values.cost ?? "").trim();
  const rechargeOwner = values.rechargeOwner === "on";
  let costCents: number | null = null;
  if (raw !== "") {
    costCents = dirhamsToCentimes(raw);
    if (costCents === null) return { ok: false, fieldErrors: { cost: "Coût : un montant en dirhams, par exemple 350 ou 1 250,50" } };
    if (costCents > MAX_TICKET_COST_CENTS) return { ok: false, fieldErrors: { cost: "Coût : 1 000 000 MAD au maximum" } };
  }
  if (rechargeOwner && costCents === null) return { ok: false, fieldErrors: { cost: "Coût : indiquez le montant à refacturer au propriétaire" } };
  return { ok: true, input: { costCents, rechargeOwner } };
}

/** A comment of the thread: 1 to 4 000 characters. */
export function parseComment(raw: string): { ok: true; body: string } | { ok: false; error: string } {
  const r = textField("Commentaire", TICKET_LIMITS.comment).safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  if (!r.data) return { ok: false, error: "Commentaire : écrivez quelque chose." };
  return { ok: true, body: r.data };
}
