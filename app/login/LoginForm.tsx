"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { authClient, useSession } from "@/lib/auth-client";

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Adresse e-mail ou mot de passe incorrect.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cette adresse. Connectez-vous.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Un compte existe déjà avec cette adresse. Connectez-vous.",
  PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
  INVALID_EMAIL: "Adresse e-mail invalide.",
};

/** Only same-site paths, so ?next= can't bounce users to another site. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { data: session } = useSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return (
      <div className="text-center">
        <p className="text-body-l">
          Vous êtes connecté·e en tant que <strong>{session.user.name}</strong>.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/trips" className="inline-flex h-12 items-center rounded-sm bg-ink px-6 font-semibold text-white">
            Mes voyages
          </Link>
          <Button
            variant="outline"
            onClick={async () => {
              await authClient.signOut();
              router.refresh();
            }}
          >
            Déconnexion
          </Button>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    setBusy(true);
    setError(null);
    const { error } =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(f.get("name") ?? "").trim() });
    setBusy(false);
    if (error) {
      setError(MESSAGES[error.code ?? ""] ?? error.message ?? "Une erreur est survenue. Réessayez.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const field = "h-14 w-full rounded-sm border border-ink-faint px-4 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink";
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
