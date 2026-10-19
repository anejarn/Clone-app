"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { QrCode } from "@/components/admin/QrCode";
import { Button } from "@/components/ui/Button";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-messages";

const field = "h-12 w-full rounded-sm border border-ink-faint bg-white px-4 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink";
const card = "max-w-2xl rounded-lg border border-line bg-white p-5 md:p-6";

/** The secret from an otpauth:// URI, in groups of four for typing by hand. */
function secretOf(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <ul data-testid="backup-codes" className="mt-3 grid grid-cols-2 gap-2 font-mono text-body sm:grid-cols-5">
      {codes.map((c) => (
        <li key={c} className="rounded-sm bg-surface-2 px-2 py-1.5 text-center">
          {c}
        </li>
      ))}
    </ul>
  );
}

type Step = { name: "start" } | { name: "scan"; totpURI: string; backupCodes: string[] } | { name: "done"; backupCodes: string[] };

/**
 * Enrollment: password → QR code and secret → first code (which turns double authentification on) → backup codes.
 * Every step goes through Better Auth's twoFactor endpoints (/api/auth/two-factor/*), which check the session. Used by
 * the team (/admin/securite, compulsory) and the owners (/proprietaire/securite, optional): `doneHref` is where to go.
 */
export function TwoFactorSetup({ enabled, doneHref = "/admin", doneLabel = "Accéder à l'espace équipe" }: { enabled: boolean; doneHref?: string; doneLabel?: string }) {
  const [step, setStep] = useState<Step>({ name: "start" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  async function run<T>(fn: () => Promise<{ data: T | null; error: { code?: string; message?: string; status?: number } | null }>) {
    setBusy(true);
    setError(null);
    const { data, error } = await fn();
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    return error ? null : data;
  }

  const errorLine = error && (
    <p role="alert" className="mt-3 text-error">
      {error}
    </p>
  );

  if (enabled && step.name !== "done") {
    return (
      <div className={card}>
        <p className="flex items-center gap-2 font-semibold" data-testid="two-factor-on">
          <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
          Double authentification activée
        </p>
        <p className="mt-2 text-ink-muted">Chaque connexion demande un code de votre application d&apos;authentification, ou un code de secours.</p>
        <form
          className="mt-5 space-y-3 border-t border-line pt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const password = String(new FormData(e.currentTarget).get("password") ?? "");
            const data = await run(() => authClient.twoFactor.generateBackupCodes({ password }));
            if (data) setNewCodes(data.backupCodes);
          }}
        >
          <p className="font-medium">Nouveaux codes de secours</p>
          <p className="text-caption text-ink-muted">Les anciens codes ne fonctionneront plus.</p>
          <label className="block">
            <span className="mb-1 block text-micro font-medium">Mot de passe</span>
            <input name="password" type="password" required autoComplete="current-password" className={field} />
          </label>
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            Générer de nouveaux codes
          </Button>
          {errorLine}
          {newCodes && <BackupCodes codes={newCodes} />}
        </form>
      </div>
    );
  }

  if (step.name === "start") {
    return (
      <form
        className={`${card} space-y-4`}
        onSubmit={async (e) => {
          e.preventDefault();
          const password = String(new FormData(e.currentTarget).get("password") ?? "");
          const data = await run(() => authClient.twoFactor.enable({ password, issuer: "Sigma" }));
          if (data && "totpURI" in data && data.totpURI) setStep({ name: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
        }}
      >
        <p className="font-semibold">Activer la double authentification</p>
        <p className="text-ink-muted">Confirmez votre mot de passe pour commencer. Gardez votre téléphone à portée de main.</p>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Mot de passe</span>
          <input name="password" type="password" required autoComplete="current-password" className={field} />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Un instant…" : "Commencer"}
        </Button>
        {errorLine}
      </form>
    );
  }

  if (step.name === "scan") {
    return (
      <div className={`${card} space-y-5`}>
        <div>
          <p className="font-semibold">1. Ajoutez Sigma à votre application d&apos;authentification</p>
          <p className="mt-1 text-ink-muted">Scannez ce QR code, ou saisissez la clé à la main.</p>
        </div>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <QrCode value={step.totpURI} label="QR code de la double authentification Sigma" className="size-44 shrink-0 rounded-sm border border-line" />
          <div className="min-w-0">
            <p className="text-micro font-medium text-ink-muted">Clé</p>
            <p data-testid="totp-secret" className="break-all font-mono text-body-l tracking-wide">
              {secretOf(step.totpURI)}
            </p>
          </div>
        </div>
        <form
          className="space-y-3 border-t border-line pt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
            const data = await run(() => authClient.twoFactor.verifyTotp({ code }));
            if (data) setStep({ name: "done", backupCodes: step.backupCodes });
          }}
        >
          <p className="font-semibold">2. Saisissez le code affiché</p>
          <label className="block max-w-xs">
            <span className="mb-1 block text-micro font-medium">Code à 6 chiffres</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className={field} />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Vérification…" : "Activer"}
          </Button>
          {errorLine}
        </form>
      </div>
    );
  }

  return (
    <div className={`${card} space-y-4`}>
      <p className="flex items-center gap-2 font-semibold" data-testid="two-factor-on">
        <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
        Double authentification activée
      </p>
      <div>
        <p className="font-medium">Vos codes de secours</p>
        <p className="mt-1 text-ink-muted">
          Chaque code sert une seule fois, si vous n&apos;avez plus votre téléphone. Notez-les et rangez-les en lieu sûr : ils ne seront plus
          affichés.
        </p>
        <BackupCodes codes={step.backupCodes} />
      </div>
      {/* A full page load, so the frame and every cached segment see the new session. */}
      <a href={doneHref} className="inline-flex h-12 items-center rounded-sm bg-brand px-6 font-semibold text-white hover:bg-brand-strong">
        {doneLabel}
      </a>
    </div>
  );
}
