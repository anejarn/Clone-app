import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ROLE_LABEL } from "@/lib/admin/users";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/generated/prisma/enums";

const pill = "inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-micro font-semibold";

const ROLE_TONE: Record<Role, string> = {
  ADMIN: "bg-brand text-white",
  AGENT: "bg-brand-tint text-brand-strong",
  OWNER: "border border-line bg-white text-ink",
  GUEST: "bg-surface-3 text-ink-muted",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={cn(pill, ROLE_TONE[role])} data-role={role}>
      {ROLE_LABEL[role]}
    </span>
  );
}

/** Staff only: double authentification on, or still to turn on (no back-office access until then). */
export function TwoFactorBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className={cn(pill, "bg-[#e8f5e9] text-[#00650a]")} data-two-factor="on">
      <ShieldCheck className="size-3.5" aria-hidden="true" />
      2FA activée
    </span>
  ) : (
    <span className={cn(pill, "bg-[#fff4e5] text-[#8a4b00]")} data-two-factor="off">
      <ShieldAlert className="size-3.5" aria-hidden="true" />
      2FA à activer
    </span>
  );
}
