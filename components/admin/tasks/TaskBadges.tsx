import { Repeat } from "lucide-react";
import type { TaskStatus, TaskType } from "@/lib/generated/prisma/enums";
import { TASK_STATUS_LABEL, TASK_TYPE_LABEL } from "@/lib/operations/labels";

const STATUS_STYLE: Record<TaskStatus, string> = {
  TODO: "border-line bg-white text-ink",
  IN_PROGRESS: "border-brand bg-brand-tint text-brand-deep",
  DONE: "border-success bg-[#e8f5e9] text-[#1b5e20]",
  CANCELLED: "border-line bg-surface-3 text-ink-muted line-through",
};

const pill = "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-caption font-medium";

export function TaskTypeBadge({ type }: { type: TaskType }) {
  return (
    <span className={`${pill} border-ink bg-white`} data-type={type}>
      {TASK_TYPE_LABEL[type]}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`${pill} ${STATUS_STYLE[status]}`} data-testid="task-status" data-status={status}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

/** A cleaning between two stays the same day: the home must be ready by check-in time. */
export function TurnoverBadge() {
  return (
    <span className={`${pill} border-error bg-[#fdecea] text-error`} data-testid="turnover">
      <Repeat className="size-3.5" aria-hidden="true" />
      Départ et arrivée le même jour
    </span>
  );
}
