/**
 * Breakdown reports (Pannes): French labels and the rules of who may change a ticket's status. Pure (no database),
 * shared by the server (lib/server/operations/tickets.ts), the forms and the unit tests.
 *
 * Who does what:
 * - an associé (ADMIN) sees every ticket of the organization and may do anything: assign, change the priority, the
 *   status (including cancelling and reopening), the cost;
 * - an agent (AGENT) sees the tickets they reported or are assigned to; on them they comment and add photos; the
 *   agent assigned to a ticket also moves it along (en cours, en attente, réparée), never cancels or reopens it.
 */

export type TicketCategoryKey = "PLUMBING" | "ELECTRICITY" | "AIR_CONDITIONING" | "APPLIANCE" | "LOCK" | "OTHER";
export type TicketPriorityKey = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketStatusKey = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CANCELLED";
export type TicketWaitingKey = "PART" | "CONTRACTOR";

export const TICKET_CATEGORY_LABEL: Record<TicketCategoryKey, string> = {
  PLUMBING: "Plomberie",
  ELECTRICITY: "Électricité",
  AIR_CONDITIONING: "Climatisation",
  APPLIANCE: "Électroménager",
  LOCK: "Serrure",
  OTHER: "Autre",
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriorityKey, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};

export const TICKET_STATUS_LABEL: Record<TicketStatusKey, string> = {
  OPEN: "Signalée",
  IN_PROGRESS: "En cours",
  WAITING: "En attente",
  RESOLVED: "Réparée",
  CANCELLED: "Annulée",
};

export const TICKET_WAITING_LABEL: Record<TicketWaitingKey, string> = {
  PART: "d'une pièce",
  CONTRACTOR: "d'un prestataire",
};

export const TICKET_CATEGORIES = Object.keys(TICKET_CATEGORY_LABEL) as TicketCategoryKey[];
export const TICKET_PRIORITIES = Object.keys(TICKET_PRIORITY_LABEL) as TicketPriorityKey[];
export const TICKET_STATUSES = Object.keys(TICKET_STATUS_LABEL) as TicketStatusKey[];
export const TICKET_WAITING = Object.keys(TICKET_WAITING_LABEL) as TicketWaitingKey[];

/** Still to be fixed: what the dashboard and the default list show. */
export const OPEN_TICKET_STATUSES: readonly TicketStatusKey[] = ["OPEN", "IN_PROGRESS", "WAITING"];

export function isOpenTicket(status: TicketStatusKey): boolean {
  return OPEN_TICKET_STATUSES.includes(status);
}

/** "En attente d'une pièce", "Réparée"… */
export function ticketStatusText(status: TicketStatusKey, waitingFor: TicketWaitingKey | null): string {
  return status === "WAITING" && waitingFor ? `En attente ${TICKET_WAITING_LABEL[waitingFor]}` : TICKET_STATUS_LABEL[status];
}

/** URL values of the filters (French, readable in the address bar). */
export const TICKET_STATUS_PARAM = {
  ouvertes: "OPEN_ANY",
  signalee: "OPEN",
  en_cours: "IN_PROGRESS",
  en_attente: "WAITING",
  reparee: "RESOLVED",
  annulee: "CANCELLED",
  toutes: "ALL",
} as const;
export const TICKET_PRIORITY_PARAM = { basse: "LOW", normale: "NORMAL", haute: "HIGH", urgente: "URGENT" } as const satisfies Record<string, TicketPriorityKey>;
export const TICKET_CATEGORY_PARAM = {
  plomberie: "PLUMBING",
  electricite: "ELECTRICITY",
  climatisation: "AIR_CONDITIONING",
  electromenager: "APPLIANCE",
  serrure: "LOCK",
  autre: "OTHER",
} as const satisfies Record<string, TicketCategoryKey>;

export interface TicketActor {
  role: "ADMIN" | "AGENT" | string;
  userId: string;
}

export interface TicketParties {
  reporterId: string | null;
  assigneeId: string | null;
}

/** Associés manage every ticket of the organization. */
export function managesTickets(role: string): boolean {
  return role === "ADMIN";
}

/** Whether the person may see (and so comment on, and photograph) a ticket. */
export function canSeeTicket(actor: TicketActor, t: TicketParties): boolean {
  return managesTickets(actor.role) || t.reporterId === actor.userId || t.assigneeId === actor.userId;
}

/**
 * The statuses the person may move a ticket to from `from` (empty: they can't change it). Associés: every other
 * status. The agent assigned to it: forward along the repair (en cours, en attente, réparée) while it is open.
 * Anyone else, the reporter included: none.
 */
export function allowedStatusChanges(actor: TicketActor, t: TicketParties & { status: TicketStatusKey }): TicketStatusKey[] {
  if (managesTickets(actor.role)) return TICKET_STATUSES.filter((s) => s !== t.status || s === "WAITING");
  if (t.assigneeId !== actor.userId || !isOpenTicket(t.status)) return [];
  return (["IN_PROGRESS", "WAITING", "RESOLVED"] as const).filter((s) => s !== t.status || s === "WAITING");
}

export type StatusChangeRefusal = "FORBIDDEN" | "SAME" | "WAITING_FOR";

/**
 * Checks a change of status. WAITING needs what it waits for (and may be re-sent with another reason);
 * any other status clears it.
 */
export function checkStatusChange(
  actor: TicketActor,
  t: TicketParties & { status: TicketStatusKey; waitingFor: TicketWaitingKey | null },
  to: TicketStatusKey,
  waitingFor: TicketWaitingKey | null,
): { ok: true } | { ok: false; reason: StatusChangeRefusal } {
  if (to === "WAITING" && !waitingFor) return { ok: false, reason: "WAITING_FOR" };
  if (to === t.status && (to !== "WAITING" || waitingFor === t.waitingFor)) return { ok: false, reason: "SAME" };
  if (!allowedStatusChanges(actor, t).includes(to)) return { ok: false, reason: "FORBIDDEN" };
  return { ok: true };
}

/** The timestamps and reason a status implies (the database checks the same: tickets_status_check). */
export function statusFields(to: TicketStatusKey, waitingFor: TicketWaitingKey | null, now: Date) {
  return {
    status: to,
    waitingFor: to === "WAITING" ? waitingFor : null,
    resolvedAt: to === "RESOLVED" ? now : null,
    cancelledAt: to === "CANCELLED" ? now : null,
  };
}
