import { Clock, MapPin, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { parseDay } from "@/lib/admin/calendar";
import { formatDate, pluralize } from "@/lib/format";
import type { TaskView } from "@/lib/server/operations/tasks";
import { TaskStatusBadge, TaskTypeBadge, TurnoverBadge } from "./TaskBadges";

const day = (s: string) => formatDate(parseDay(s)!);

/** "Lundi 19/10/2026" style heading of a day of tasks. */
export function dayHeading(iso: string, today: string): string {
  const d = parseDay(iso)!;
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(d);
  const tomorrow = new Date(parseDay(today)!.getTime() + 86_400_000).toISOString().slice(0, 10);
  const prefix = iso === today ? "Aujourd'hui · " : iso === tomorrow ? "Demain · " : "";
  return `${prefix}${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatDate(d)}`;
}

/** One task in a list: a link to `href`, the essentials, and optional controls (e.g. assignment). */
export function TaskCard({ task, href, children, showAssignee = true }: { task: TaskView; href: string; children?: ReactNode; showAssignee?: boolean }) {
  return (
    <li className="p-3 md:px-4" data-testid="task-row" data-type={task.type} data-status={task.status} data-listing={task.listingId}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-caption font-semibold text-ink-muted">
            <Clock className="size-3.5" aria-hidden="true" />
            {task.startTime}–{task.endTime}
          </p>
          <Link href={href} className="mt-0.5 block font-semibold hover:underline">
            {task.title} · {task.listingTitle}
          </Link>
          <p className="truncate text-caption text-ink-muted">
            {task.address} · {task.placeName}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <TaskTypeBadge type={task.type} />
            <TaskStatusBadge status={task.status} />
            {task.turnover && <TurnoverBadge />}
            {task.itemCount > 0 && (
              <span className="text-caption text-ink-muted" data-testid="task-progress">
                {task.checkedCount}/{task.itemCount} coché{task.checkedCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 space-y-2 md:text-right">
          {showAssignee && (
            <p className="flex items-center gap-1.5 text-caption md:justify-end" data-testid="task-assignee">
              <UserRound className="size-3.5" aria-hidden="true" />
              {task.assignee ? task.assignee.name : <span className="font-semibold text-error">Non affectée</span>}
            </p>
          )}
          {children}
        </div>
      </div>
    </li>
  );
}

/** What a task is about: the home, the window, the stay it comes from (no amounts). */
export function TaskFacts({ task, bookingHref }: { task: TaskView; bookingHref?: string }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2" data-testid="task-facts">
      <div>
        <dt className="text-micro font-medium text-ink-muted">Quand</dt>
        <dd className="font-semibold" data-testid="task-when">
          {day(task.scheduledDate)}, {task.startTime}–{task.endTime}
        </dd>
      </div>
      <div>
        <dt className="text-micro font-medium text-ink-muted">Logement</dt>
        <dd>
          <p className="font-semibold">{task.listingTitle}</p>
          <p className="flex items-start gap-1 text-caption text-ink-muted">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {task.address} · {task.placeName}
          </p>
        </dd>
      </div>
      <div>
        <dt className="text-micro font-medium text-ink-muted">Statut</dt>
        <dd className="mt-1 flex flex-wrap gap-1.5">
          <TaskTypeBadge type={task.type} />
          <TaskStatusBadge status={task.status} />
          {task.turnover && <TurnoverBadge />}
        </dd>
      </div>
      <div>
        <dt className="text-micro font-medium text-ink-muted">Affectée à</dt>
        <dd data-testid="task-assignee">{task.assignee?.name ?? "Personne"}</dd>
      </div>
      {task.booking && (
        <div className="sm:col-span-2">
          <dt className="text-micro font-medium text-ink-muted">Séjour</dt>
          <dd>
            {task.booking.guestName ?? "Voyageur"} · {SOURCE_LABEL[task.booking.source]} · du {day(task.booking.checkIn)} au {day(task.booking.checkOut)}
            {task.booking.guests > 0 && ` · ${pluralize(task.booking.guests, "voyageur", "voyageurs")}`}
            {task.booking.guestPhone && (
              <>
                {" · "}
                <a href={`tel:${task.booking.guestPhone.replace(/\s/g, "")}`} className="underline underline-offset-2">
                  {task.booking.guestPhone}
                </a>
              </>
            )}
            {task.booking.cancelled && <span className="ml-2 font-semibold text-error">Séjour annulé</span>}
            {bookingHref && (
              <>
                {" · "}
                <Link href={bookingHref} className="underline underline-offset-2">
                  Voir la réservation
                </Link>
              </>
            )}
          </dd>
        </div>
      )}
      {task.notes && (
        <div className="sm:col-span-2">
          <dt className="text-micro font-medium text-ink-muted">Consignes</dt>
          <dd className="whitespace-pre-line">{task.notes}</dd>
        </div>
      )}
    </dl>
  );
}
