"use client";

import { RotateCw, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { resendInvitationAction, revokeInvitationAction, type IssuedLink } from "@/app/admin/utilisateurs/actions";
import { INVITATION_STATUS_LABEL, ROLE_LABEL, type InvitationStatus } from "@/lib/admin/users";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/generated/prisma/enums";
import { IssuedLinkCard } from "./IssuedLinkCard";

export interface InvitationItem {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expires: string;
  invitedBy: string | null;
}

/** Open invitations: resend (new link, the old one stops working) or revoke. */
export function InvitationList({ items }: { items: InvitationItem[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  function run(fn: () => Promise<{ error?: string; issued?: IssuedLink }>) {
    setError(null);
    setIssued(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      if (r.issued) setIssued(r.issued);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          {error}
        </p>
      )}
      {issued && <IssuedLinkCard issued={issued} />}
      <ul className="divide-y divide-line rounded-lg border border-line bg-white" data-testid="invitation-rows">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:gap-4 md:p-4" data-invitation-email={i.email}>
            <div className="min-w-0 flex-1">
              <p className="break-all font-semibold">{i.email}</p>
              <p className="text-caption text-ink-muted">
                {ROLE_LABEL[i.role]}
                {i.invitedBy && ` · invité·e par ${i.invitedBy}`} · {i.status === "EXPIRED" ? "expirée depuis le" : "expire le"} {i.expires}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-pill px-2.5 py-0.5 text-micro font-semibold",
                i.status === "EXPIRED" ? "bg-[#fff4e5] text-[#8a4b00]" : "bg-brand-tint text-brand-strong",
              )}
            >
              {INVITATION_STATUS_LABEL[i.status]}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => resendInvitationAction(i.id))}
                className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-ink bg-white px-3 font-semibold hover:bg-surface-2 disabled:opacity-50"
                aria-label={`Renvoyer l'invitation de ${i.email}`}
              >
                <RotateCw className="size-4" aria-hidden="true" />
                Renvoyer
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Révoquer l'invitation de ${i.email} ? Le lien ne fonctionnera plus.`)) run(() => revokeInvitationAction(i.id));
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line bg-white px-3 font-semibold text-error hover:bg-[#fdecea] disabled:opacity-50"
                aria-label={`Révoquer l'invitation de ${i.email}`}
              >
                <XCircle className="size-4" aria-hidden="true" />
                Révoquer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
