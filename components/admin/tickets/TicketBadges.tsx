import type { TicketPriority, TicketStatus, TicketWaitingFor } from "@/lib/generated/prisma/enums";
import { TICKET_PRIORITY_LABEL, ticketStatusText } from "@/lib/operations/tickets";

const pill = "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-caption font-medium";

const PRIORITY_STYLE: Record<TicketPriority, string> = {
  LOW: "border-line bg-white text-ink-muted",
  NORMAL: "border-line bg-white text-ink",
  HIGH: "border-[#b45309] bg-[#fff7ed] text-[#7c2d12]",
  URGENT: "border-error bg-error text-white",
};

const STATUS_STYLE: Record<TicketStatus, string> = {
  OPEN: "border-ink bg-white text-ink",
  IN_PROGRESS: "border-brand bg-brand-tint text-brand-deep",
  WAITING: "border-[#b45309] bg-[#fff7ed] text-[#7c2d12]",
  RESOLVED: "border-success bg-[#e8f5e9] text-[#1b5e20]",
  CANCELLED: "border-line bg-surface-3 text-ink-muted line-through",
};

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`${pill} ${PRIORITY_STYLE[priority]}`} data-testid="ticket-priority" data-priority={priority}>
      {priority === "URGENT" ? "Urgente" : `Priorité ${TICKET_PRIORITY_LABEL[priority].toLowerCase()}`}
    </span>
  );
}

export function TicketStatusBadge({ status, waitingFor }: { status: TicketStatus; waitingFor: TicketWaitingFor | null }) {
  return (
    <span className={`${pill} ${STATUS_STYLE[status]}`} data-testid="ticket-status" data-status={status}>
      {ticketStatusText(status, waitingFor)}
    </span>
  );
}

export function TicketBadges({ ticket }: { ticket: { priority: TicketPriority; status: TicketStatus; waitingFor: TicketWaitingFor | null } }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <TicketPriorityBadge priority={ticket.priority} />
      <TicketStatusBadge status={ticket.status} waitingFor={ticket.waitingFor} />
    </span>
  );
}
