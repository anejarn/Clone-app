"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useId, useState } from "react";
import type { IssuedLink } from "@/app/admin/utilisateurs/actions";

/**
 * The invitation link, shown once (only its hash is stored): copy it, or open WhatsApp with the message ready.
 * Nothing is sent by Sigma while no e-mail/WhatsApp provider is configured (lib/notifications).
 */
export function IssuedLinkCard({ issued }: { issued: IssuedLink }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="space-y-3 rounded-lg border border-brand bg-brand-tint p-4 md:p-5" data-testid="invitation-link">
      <p className="font-semibold text-brand-deep">Invitation prête pour {issued.email}</p>
      <p className="text-ink">
        {issued.delivered
          ? "Le message a été envoyé."
          : "Aucun envoi automatique n'est configuré : transmettez ce lien vous-même. Il ne sera plus affiché ensuite."}{" "}
        Valable une fois, jusqu&apos;au {issued.expires}.
      </p>
      <label htmlFor={id} className="block text-micro font-medium">
        Lien d&apos;invitation
      </label>
      <input
        id={id}
        readOnly
        value={issued.link}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 w-full rounded-sm border border-ink-faint bg-white px-3 font-mono text-caption outline-none focus:border-ink"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(issued.link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="inline-flex h-10 items-center gap-2 rounded-sm bg-ink px-4 font-semibold text-white hover:bg-black"
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Lien copié" : "Copier le lien"}
        </button>
        <a
          href={issued.whatsapp}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold text-ink hover:bg-surface-2"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          Partager sur WhatsApp
        </a>
      </div>
    </div>
  );
}
