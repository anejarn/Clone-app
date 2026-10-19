import { REQUEST_STATUS_LABEL } from "@/lib/concierge/catalog";
import type { ServiceRequestStatus } from "@/lib/generated/prisma/enums";

const TONE: Record<ServiceRequestStatus, string> = {
  NEW: "bg-[#fdecea] text-error",
  SENT_TO_PARTNER: "bg-brand-tint text-brand-deep",
  CONFIRMED: "bg-[#e6f4e7] text-[#0b5e0f]",
  DONE: "bg-surface-3 text-ink",
  CANCELLED: "bg-surface-3 text-ink",
  REFUSED: "bg-surface-3 text-ink",
};

export function RequestStatusBadge({ status }: { status: ServiceRequestStatus }) {
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-micro font-semibold ${TONE[status]}`} data-testid="request-status">
      {REQUEST_STATUS_LABEL[status]}
    </span>
  );
}
