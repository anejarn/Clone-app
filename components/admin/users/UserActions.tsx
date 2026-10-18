"use client";

import { useActionState, useId } from "react";
import { changeRoleAction, resetTwoFactorAction, setUserActiveAction, type ActionState } from "@/app/admin/utilisateurs/actions";
import { Button } from "@/components/ui/Button";
import { ROLE_LABEL, ROLES } from "@/lib/admin/users";
import type { Role } from "@/lib/generated/prisma/enums";

const input = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
        {state.message}
      </p>
    );
  }
  return null;
}

function Confirm({ label }: { label: string }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name="confirm" required className="mt-1 size-4 accent-brand" />
      <span>{label}</span>
    </label>
  );
}

export function RoleForm({ userId, role, self }: { userId: string; role: Role; self: boolean }) {
  const [state, action, pending] = useActionState(changeRoleAction.bind(null, userId), {});
  const id = useId();
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Rôle</h2>
      <p className="text-ink-muted">
        Le changement s&apos;applique tout de suite et déconnecte la personne de ses appareils. Un agent ou un associé doit avoir la double
        authentification pour entrer dans l&apos;espace équipe.
        {self && " Attention : c'est votre propre compte, vous serez déconnecté·e."}
      </p>
      <Feedback state={state} />
      <label htmlFor={id} className="block text-micro font-medium">
        Nouveau rôle
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <select id={id} name="role" defaultValue={role} className={`${input} sm:max-w-xs`}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="dark" disabled={pending}>
          {pending ? "Un instant…" : "Changer le rôle"}
        </Button>
      </div>
    </form>
  );
}

export function ResetTwoFactorForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetTwoFactorAction.bind(null, userId), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Téléphone perdu : réinitialiser la double authentification</h2>
      <p className="text-ink-muted">
        La clé et les codes de secours actuels ne fonctionneront plus. La personne est déconnectée et devra activer à nouveau la double
        authentification à sa prochaine connexion. Vérifiez son identité avant (appel, en personne).
      </p>
      <Feedback state={state} />
      <label className="block max-w-sm">
        <span className="mb-1 block text-micro font-medium">Votre mot de passe</span>
        <input name="password" type="password" required autoComplete="current-password" className={input} />
      </label>
      <Confirm label="Je confirme avoir vérifié l'identité de la personne." />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Réinitialiser la double authentification"}
      </Button>
    </form>
  );
}

export function ActiveForm({ userId, active }: { userId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setUserActiveAction.bind(null, userId, !active), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">{active ? "Désactiver le compte" : "Réactiver le compte"}</h2>
      <p className="text-ink-muted">
        {active
          ? "La personne ne pourra plus se connecter et est déconnectée de ses appareils. Rien n'est supprimé : biens, réservations et historique restent."
          : "La personne pourra se connecter à nouveau, avec le même rôle."}
      </p>
      <Feedback state={state} />
      {active && <Confirm label="Je confirme vouloir désactiver ce compte." />}
      <Button type="submit" variant={active ? "outline" : "primary"} disabled={pending} className={active ? "border-error text-error" : undefined}>
        {pending ? "Un instant…" : active ? "Désactiver le compte" : "Réactiver le compte"}
      </Button>
    </form>
  );
}
