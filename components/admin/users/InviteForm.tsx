"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { inviteUserAction, type IssuedLink } from "@/app/admin/utilisateurs/actions";
import { Button } from "@/components/ui/Button";
import { INVITABLE_ROLES, ROLE_LABEL, USER_LIMITS } from "@/lib/admin/users";
import { IssuedLinkCard } from "./IssuedLinkCard";

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";

const ROLE_HINT = {
  OWNER: "Accès au portail propriétaire (bientôt) : ses biens, réservations et relevés.",
  AGENT: "Espace équipe : tableau de bord, réservations, calendrier. Double authentification obligatoire.",
  ADMIN: "Espace équipe complet, dont les utilisateurs et les biens. Double authentification obligatoire.",
} as const;

/** Invite a propriétaire, an agent or an associé: the server answers with the link to share. */
export function InviteForm() {
  const [state, action, pending] = useActionState(inviteUserAction, {});
  // "Inviter quelqu'un d'autre" hides the link just shown; the next answer replaces it.
  const [dismissed, setDismissed] = useState<IssuedLink | null>(null);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? { email: "", role: "OWNER", phone: "" };

  if (state.issued && state.issued !== dismissed) {
    return (
      <div className="max-w-2xl space-y-4">
        <IssuedLinkCard issued={state.issued} />
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/utilisateurs"
            className="inline-flex h-11 items-center rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2"
          >
            Retour aux utilisateurs
          </Link>
          <Button type="button" variant="link" onClick={() => setDismissed(state.issued ?? null)}>
            Inviter quelqu&apos;un d&apos;autre
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="max-w-2xl space-y-5 rounded-lg border border-line bg-white p-4 md:p-6">
      {state.error && (
        <div role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          <p className="font-semibold">{state.error}</p>
          {Object.keys(errors).length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(errors).map(([k, m]) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Adresse e-mail</span>
        <input
          name="email"
          type="email"
          required
          maxLength={USER_LIMITS.email}
          defaultValue={values.email}
          aria-invalid={!!errors.email || undefined}
          className={input}
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-micro font-medium">Rôle</legend>
        <div className="space-y-2">
          {INVITABLE_ROLES.map((r) => (
            <label
              key={r}
              className="flex items-start gap-3 rounded-sm border border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-tint"
            >
              <input type="radio" name="role" value={r} defaultChecked={values.role === r} className="mt-1 size-4 accent-brand" />
              <span>
                <span className="block font-semibold">{ROLE_LABEL[r]}</span>
                <span className="block text-caption text-ink-muted">{ROLE_HINT[r]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Téléphone WhatsApp (facultatif)</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            maxLength={USER_LIMITS.phone}
            placeholder="+212 6 12 34 56 78"
            defaultValue={values.phone}
            aria-invalid={!!errors.phone || undefined}
            aria-describedby="phone-hint"
            className={input}
          />
        </label>
        <p id="phone-hint" className="mt-1 text-caption text-ink-muted">
          Pour ouvrir WhatsApp directement sur la bonne conversation.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Un instant…" : "Créer l'invitation"}
        </Button>
        <Link href="/admin/utilisateurs" className="inline-flex h-12 items-center px-2 font-semibold underline underline-offset-2">
          Annuler
        </Link>
      </div>
    </form>
  );
}
