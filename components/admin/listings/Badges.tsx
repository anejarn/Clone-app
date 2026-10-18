import { AlertTriangle, CircleAlert, FileQuestion } from "lucide-react";
import { LICENSE_BADGE, licenseSentence, type LicenseFields, type LicenseState } from "@/lib/admin/license";
import { LISTING_STATUS_LABEL, MANAGEMENT_TYPE_LABEL } from "@/lib/admin/listing-form";
import { cn } from "@/lib/cn";
import { bpsToPercent } from "@/lib/money";

const pill = "inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-micro font-semibold";

/** Expired: error red; expiring: amber; missing: grey. A valid authorisation gets no badge in lists. */
const LICENSE_TONE = {
  EXPIRED: "bg-[#fdecea] text-error",
  EXPIRING: "bg-[#fff4e5] text-[#8a4b00]",
  MISSING: "bg-surface-3 text-ink-muted",
  VALID: "bg-[#e8f5e9] text-[#00650a]",
} as const;

export function LicenseBadge({ state, showValid = false }: { state: LicenseState; showValid?: boolean }) {
  if (state.status === "VALID" && !showValid) return null;
  return (
    <span className={cn(pill, LICENSE_TONE[state.status])} data-license={state.status}>
      {LICENSE_BADGE[state.status]}
    </span>
  );
}

export function StatusBadge({ status }: { status: keyof typeof LISTING_STATUS_LABEL }) {
  return (
    <span className={cn(pill, status === "PUBLISHED" ? "bg-brand-tint text-brand-strong" : "bg-surface-3 text-ink")}>{LISTING_STATUS_LABEL[status]}</span>
  );
}

export function ManagementBadge({ type, commissionBps }: { type: keyof typeof MANAGEMENT_TYPE_LABEL; commissionBps: number }) {
  return (
    <span className={cn(pill, "border border-line bg-white text-ink")}>
      {type === "MANAGED" ? `Mandat · ${bpsToPercent(commissionBps)} %` : MANAGEMENT_TYPE_LABEL.SUBLEASE}
    </span>
  );
}

/** The 80-14 notice on a listing's page; an alert while the authorisation is missing, expired or expiring. */
export function LicenseNotice({ fields, state }: { fields: LicenseFields; state: LicenseState }) {
  const Icon = state.status === "MISSING" ? FileQuestion : state.status === "EXPIRED" ? CircleAlert : AlertTriangle;
  const tone =
    state.status === "EXPIRED"
      ? "border-error bg-[#fdecea] text-error"
      : state.status === "EXPIRING"
        ? "border-[#e0a54a] bg-[#fff4e5] text-[#8a4b00]"
        : state.status === "MISSING"
          ? "border-line bg-surface-3 text-ink"
          : "border-line bg-white text-ink";
  return (
    <div role={state.status === "VALID" ? undefined : "alert"} data-testid="license-notice" data-license={state.status} className={cn("flex items-start gap-3 rounded-lg border p-4", tone)}>
      {state.status !== "VALID" && <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
      <p className="font-medium">{licenseSentence(fields, state)}</p>
    </div>
  );
}
