"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { authClient, useSession } from "@/lib/auth-client";
import { signOut } from "@/lib/sign-out";
import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { safeRedirectPath } from "@/lib/safe-redirect";

/** Team members land in the back-office unless the link said otherwise. */
function destination(next: string | null, role: unknown): string {
  if (!next && (role === "ADMIN" || role === "AGENT")) return "/admin";
  if (!next && role === "OWNER") return "/proprietaire";
  return safeRedirectPath(next, window.location.origin);
}

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const { data: session } = useSession();
  const [mode, setMode] = useState<"signin" | "signup" | "twoFactor">("signin");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session && mode !== "twoFactor") {
    return (
      <div className="text-center">
        <p className="text-body-l">
          Vous êtes connecté·e en tant que <strong>{session.user.name}</strong>.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/trips" className="inline-flex h-12 items-center rounded-sm bg-ink px-6 font-semibold text-white">
            Mes séjours
          </Link>
          <Button
            variant="outline"
            onClick={async () => {
              if (await signOut()) router.refresh();
            }}
          >
            Déconnexion
          </Button>
        </div>
      </div>
    );
  }

  function done(role: unknown) {
    // Same-origin paths only, so a crafted login link can't send people to another site.
    router.replace(destination(next, role));
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    setBusy(true);
    setError(null);
    const { data, error } =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(f.get("name") ?? "").trim() });
    setBusy(false);
    if (error) {
      setError(AUTH_MESSAGES[error.code ?? ""] ?? error.message ?? "Une erreur est survenue. Réessayez.");
      return;
    }
    // Double authentification on: no session yet, the code comes next.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setMode("twoFactor");
      return;
    }
    done(data && "user" in data ? (data.user as { role?: unknown }).role : undefined);
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { data, error } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) {
      const message = AUTH_MESSAGES[error.code ?? ""] ?? "Une erreur est survenue. Réessayez.";
      setError(message);
      // The challenge is over (expired or too many attempts): start again from the password.
      if (error.code === "INVALID_TWO_FACTOR_COOKIE" || error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") setMode("signin");
      return;
    }
    done((data?.user as { role?: unknown } | undefined)?.role);
  }

  const field = "h-14 w-full rounded-sm border border-ink-faint px-4 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  if (mode === "twoFactor") {
    return (
      <form onSubmit={onCode} className="space-y-3 text-left">
        <h1 className="mb-2 text-center text-title-l font-semibold">Double authentification</h1>
        <p className="mb-6 text-center text-ink-muted">
          {useBackupCode
            ? "Saisissez l'un de vos codes de secours. Chaque code ne sert qu'une fois."
            : "Saisissez le code à 6 chiffres affiché par votre application d'authentification."}
        </p>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">{useBackupCode ? "Code de secours" : "Code à 6 chiffres"}</span>
          <input
            key={useBackupCode ? "backup" : "totp"}
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useBackupCode ? "text" : "numeric"}
            maxLength={useBackupCode ? 32 : 7}
            className={field}
          />
        </label>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "Vérification…" : "Valider"}
        </Button>
        <p className="pt-2 text-center">
          <button
            type="button"
            className="font-semibold text-ink underline"
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setError(null);
            }}
          >
            {useBackupCode ? "Utiliser l'application d'authentification" : "Utiliser un code de secours"}
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-left" noValidate={false}>
      <h1 className="mb-6 text-center text-title-l font-semibold">{mode === "signin" ? "Connexion" : "Inscription"}</h1>
      {mode === "signup" && (
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Prénom</span>
          <input name="name" required maxLength={80} autoComplete="given-name" className={field} />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Adresse e-mail</span>
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Mot de passe</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Un instant…" : mode === "signin" ? "Se connecter" : "Créer mon compte"}
      </Button>
      <p className="pt-2 text-center text-ink-muted">
        {mode === "signin" ? "Pas encore de compte ?" : "Déjà inscrit·e ?"}{" "}
        <button
          type="button"
          className="font-semibold text-ink underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
        >
          {mode === "signin" ? "Inscrivez-vous" : "Connectez-vous"}
        </button>
      </p>
    </form>
  );
}
