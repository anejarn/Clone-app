import { canRevealForTask } from "@/lib/guide/access";

/**
 * Who may record travellers' identity documents, pure. Associés (ADMIN) see, search, export and change every fiche of
 * their organization (Déclarations). An agent (AGENT) never browses them: they may only add or correct the fiches of
 * the stay of a welcome task (CHECKIN) assigned to them, scheduled today or tomorrow (Marrakech), neither done nor
 * cancelled — the same window as the access codes (lib/guide/access.ts). Once the task is done or past, the agent no
 * longer sees anything. An associé may use the same check-in screen for any welcome task not cancelled.
 */
export function canCaptureForTask(
  actor: { role: string; userId: string },
  task: { type: string; bookingId: string | null; assigneeId: string | null; scheduledDate: Date; status: string },
  today: Date,
): boolean {
  if (task.type !== "CHECKIN" || !task.bookingId) return false;
  return canRevealForTask(actor, task, today);
}
