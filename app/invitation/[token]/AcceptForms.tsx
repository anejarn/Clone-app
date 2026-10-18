"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/lib/sign-out";
import { USER_LIMITS } from "@/lib/admin/users";
import { acceptWithExistingAccountAction, acceptWithNewAccountAction, type AcceptState } from "./actions";

const field =
  "h-12 w-full rounded-sm border border-ink-faint bg-white px-4 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error read-only:bg-surface-2";

function ErrorBox({ state }: { state: AcceptState }) {
  if (!state.error) return null;
  return (
    <div role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
      <p className="font-semibold">{state.error}</p>
      {state.fieldErrors && Object.keys(state.fieldErrors).length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {Object.entries(state.fieldErrors).map(([k, m]) => (
            <li key={k}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** No account yet: name and password; the e-mail is the invited one. */
export function NewAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptWithNewAccountAction.bind(null, token), {});
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-white p-5 md:p-6">
      <p className="font-semibold">Créez votre accès</p>
      <ErrorBox state={state} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Adresse e-mail</span>
        <input value={email} readOnly className={field} autoComplete="username" name="email-display" />
      </label>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Nom et prénom</span>
        <input
          name="name"
          required
          maxLength={USER_LIMITS.name}
          autoComplete="name"
          defaultValue={state.values?.name}
          aria-invalid={!!state.fieldErrors?.name || undefined}
          className={field}
        />
      </label>
      <div>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Mot de passe</span>
          <input
            name="password"
            type="password"
            required
            minLength={USER_LIMITS.passwordMin}
            maxLength={USER_LIMITS.passwordMax}
            autoComplete="new-password"
            aria-invalid={!!state.fieldErrors?.password || undefined}
            aria-describedby="password-hint"
            className={field}
          />
        </label>
        <p id="password-hint" className="mt-1 text-caption text-ink-muted">
          {USER_LIMITS.passwordMin} caractères au moins.
        </p>
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Un instant…" : "Créer mon compte et rejoindre l'équipe"}
      </Button>
    </form>
  );
}

/** Signed in with the invited e-mail: one click. */
export function AcceptExistingForm({ token, name }: { token: string; name: string }) {
  const [state, action, pending] = useActionState(acceptWithExistingAccountAction.bind(null, token), {});
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-white p-5 md:p-6">
      <p>
        Connecté·e en tant que <strong>{name}</strong>.
      </p>
      <ErrorBox state={state} />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Un instant…" : "Accepter l'invitation"}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (await signOut()) router.refresh();
        setBusy(false);
      }}
    >
      Déconnexion
    </Button>
  );
}
