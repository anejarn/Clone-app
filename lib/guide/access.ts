/**
 * Who in the team may see a home's access codes from a field task's page (Mes tâches), pure: an associé (ADMIN)
 * for any task of the organization that isn't cancelled; an agent (AGENT) only for a task assigned to them, scheduled
 * today or tomorrow (Marrakech; `today` as a UTC midnight), neither cancelled nor done. The associés also see them
 * on the guide page of the home; nobody else, and never in « Ma journée » (nothing secret is kept on a phone).
 */
export function canRevealForTask(
  actor: { role: string; userId: string },
  task: { assigneeId: string | null; scheduledDate: Date; status: string },
  today: Date,
): boolean {
  if (task.status === "CANCELLED") return false;
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "AGENT" || task.assigneeId !== actor.userId || task.status === "DONE") return false;
  const day = task.scheduledDate.getTime();
  return day >= today.getTime() && day <= today.getTime() + 86_400_000;
}
