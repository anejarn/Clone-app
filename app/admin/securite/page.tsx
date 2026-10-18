import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { requireAdminPage } from "@/lib/server/authz";
import { TwoFactorSetup } from "./TwoFactorSetup";

export const metadata: Metadata = { title: "Sécurité du compte" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

/** Double authentification: the only back-office page open to staff who haven't turned it on yet. */
async function Content() {
  const { user } = await requireAdminPage("/admin/securite");
  return (
    <AdminPage
      title="Sécurité du compte"
      intro="La double authentification est obligatoire pour l'équipe : à chaque connexion, en plus du mot de passe, un code à 6 chiffres donné par une application d'authentification (Google Authenticator, Microsoft Authenticator, 1Password…)."
    >
      <TwoFactorSetup enabled={user.twoFactorEnabled} />
    </AdminPage>
  );
}
