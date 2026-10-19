import type { Metadata } from "next";
import { Suspense } from "react";
import { TwoFactorSetup } from "@/app/admin/securite/TwoFactorSetup";
import { OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { ownerContext } from "@/lib/server/owner/context";

export const metadata: Metadata = { title: "Sécurité du compte" };

/**
 * Double authentification for owners: optional (owners see their own figures and documents only, read-only), offered
 * and recommended here; once on, every sign-in asks for the code. The enrollment screens are the team's (French).
 */
export default function Page() {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { access, locale, t } = await ownerContext("/proprietaire/securite");
  return (
    <OwnerFrame locale={locale} t={t} active="security" here="/proprietaire/securite" title={t.security.title} intro={t.security.intro}>
      {t.security.note && <p className="mb-4 text-caption text-ink-muted">{t.security.note}</p>}
      <div lang="fr" dir="ltr">
        <TwoFactorSetup enabled={access.user.twoFactorEnabled} doneHref="/proprietaire" doneLabel="Retour à l'espace propriétaire" />
      </div>
    </OwnerFrame>
  );
}
