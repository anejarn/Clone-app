import { CheckCircle2, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { ROLE_LABEL, isStaffRole } from "@/lib/admin/users";
import { getCurrentUser } from "@/lib/server/auth";
import { viewInvitation } from "@/lib/server/invitations";
import { AcceptExistingForm, NewAccountForm, SignOutButton } from "./AcceptForms";

export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false, follow: false },
  // The link is a secret: never send it to another site as a referrer.
  referrer: "no-referrer",
};

export default function Page({ params }: PageProps<"/invitation/[token]">) {
  return (
    <>
      <Header variant="compact" />
      <main className="gutter mx-auto max-w-[520px] py-10 md:py-12">
        <Suspense fallback={<p className="text-ink-muted">Chargement…</p>}>
          <Content params={params} />
        </Suspense>
      </main>
    </>
  );
}

function Notice({ tone, title, children }: { tone: "ok" | "error"; title: string; children?: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : CircleAlert;
  return (
    <div className="rounded-lg border border-line bg-white p-5 md:p-6" role={tone === "error" ? "alert" : "status"}>
      <h1 className="flex items-center gap-2 text-title font-semibold">
        <Icon className={`size-6 shrink-0 ${tone === "ok" ? "text-success" : "text-error"}`} aria-hidden="true" />
        {title}
      </h1>
      {children && <div className="mt-3 space-y-3 text-ink-muted">{children}</div>}
    </div>
  );
}

async function Content({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Per request, never prerendered: the invitation's state depends on the time and on the database.
  await connection();
  const [inv, user] = await Promise.all([viewInvitation(token), getCurrentUser()]);
  if (!inv) {
    return (
      <Notice tone="error" title="Invitation introuvable">
        <p>Ce lien ne fonctionne pas, ou a été remplacé par un plus récent. Demandez un nouveau lien à la personne qui vous a invité·e.</p>
      </Notice>
    );
  }
  if (inv.status === "ACCEPTED") {
    if (user && user.id === inv.acceptedById) {
      return (
        <Notice tone="ok" title={`Bienvenue chez ${inv.organizationName}`}>
          <p>Votre accès {ROLE_LABEL[inv.role].toLowerCase()} est prêt.</p>
          {isStaffRole(inv.role) ? (
            <Link href="/admin" className="inline-flex h-12 items-center rounded-sm bg-brand px-6 font-semibold text-white hover:bg-brand-strong">
              Accéder à l&apos;espace équipe
            </Link>
          ) : (
            <p>Le portail propriétaire (biens, réservations, relevés) ouvrira prochainement : l&apos;équipe vous préviendra.</p>
          )}
        </Notice>
      );
    }
    return (
      <Notice tone="error" title="Invitation déjà utilisée">
        <p>Si c&apos;était vous, connectez-vous avec votre compte.</p>
      </Notice>
    );
  }
  if (inv.status === "REVOKED" || inv.status === "EXPIRED") {
    return (
      <Notice tone="error" title={inv.status === "REVOKED" ? "Invitation annulée" : "Invitation expirée"}>
        <p>Demandez un nouveau lien à l&apos;équipe {inv.organizationName}.</p>
      </Notice>
    );
  }

  const intro = (
    <>
      <h1 className="text-title-l font-semibold">Rejoindre {inv.organizationName}</h1>
      <p className="mt-2 text-ink-muted">
        Vous êtes invité·e en tant que <strong className="text-ink">{ROLE_LABEL[inv.role].toLowerCase()}</strong>, avec l&apos;adresse{" "}
        <strong className="break-all text-ink">{inv.email}</strong>.
        {isStaffRole(inv.role) && " Vous activerez ensuite la double authentification (application sur votre téléphone)."}
      </p>
    </>
  );

  if (user) {
    if (user.email.toLowerCase() !== inv.email) {
      return (
        <div className="space-y-5">
          {intro}
          <div className="rounded-lg border border-line bg-white p-5" role="alert">
            <p>
              Vous êtes connecté·e avec <strong className="break-all">{user.email}</strong>. Cette invitation est pour une autre adresse :
              déconnectez-vous, puis rouvrez ce lien.
            </p>
            <div className="mt-4">
              <SignOutButton />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-5">
        {intro}
        <AcceptExistingForm token={token} name={user.name} />
      </div>
    );
  }

  if (inv.accountExists) {
    return (
      <div className="space-y-5">
        {intro}
        <div className="rounded-lg border border-line bg-white p-5">
          <p>Un compte existe déjà avec cette adresse. Connectez-vous, puis acceptez l&apos;invitation.</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/invitation/${token}`)}`}
            className="mt-4 inline-flex h-12 items-center rounded-sm bg-brand px-6 font-semibold text-white hover:bg-brand-strong"
          >
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {intro}
      <NewAccountForm token={token} email={inv.email} />
    </div>
  );
}
