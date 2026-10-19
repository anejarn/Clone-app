import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { AuditList } from "@/components/admin/users/AuditList";
import { RoleBadge, TwoFactorBadge } from "@/components/admin/users/Badges";
import { OwnerDocuments } from "@/components/admin/users/OwnerDocuments";
import { ActiveForm, ResetTwoFactorForm, RoleForm } from "@/components/admin/users/UserActions";
import { isStaffRole } from "@/lib/admin/users";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import { getOrgUser } from "@/lib/server/admin/users";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { ID_RE } from "@/lib/server/schemas";
import { db } from "@/lib/server/db";
import { listOwnerDocuments, OWNER_DOCUMENT_KIND_LABEL, OWNER_DOCUMENT_KINDS } from "@/lib/server/owner/documents";

export const metadata: Metadata = { title: "Fiche utilisateur" };

export default function Page({ params }: PageProps<"/admin/utilisateurs/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, user: me } = await requireAdminPage("/admin/utilisateurs");
  const { id } = await params;
  // A member of another organization is "not found", as an unknown id.
  const u = ID_RE.test(id) ? await getOrgUser(organizationId, id) : null;
  if (!u) notFound();
  const self = u.id === me.id;
  const [audit, docs, ownerListings] = await Promise.all([
    recentAudit(organizationId, { targetId: u.id, take: 20 }),
    u.role === "OWNER" ? listOwnerDocuments(organizationId, u.id) : [],
    u.role === "OWNER" ? db.listing.findMany({ where: { organizationId, ownerId: u.id }, select: { id: true, title: true }, orderBy: { title: "asc" } }) : [],
  ]);
  const rows: [string, string][] = [
    ["E-mail", u.email],
    ["Téléphone", u.phone ?? "—"],
    ["Compte créé le", formatDate(u.createdAt)],
    ["Dernière connexion", u.lastSignInAt ? formatDateTime(u.lastSignInAt) : "Jamais"],
    [
      "Invitation",
      u.invitation?.acceptedAt
        ? `acceptée le ${formatDate(u.invitation.acceptedAt)}${u.invitation.invitedBy ? `, envoyée par ${u.invitation.invitedBy.name}` : ""}`
        : "—",
    ],
    ["Sessions ouvertes", String(u.sessionCount)],
  ];
  if (u.role === "OWNER" || u.listingCount > 0) rows.push(["Biens", pluralize(u.listingCount, "bien", "biens")]);

  return (
    <AdminPage
      title={u.name}
      intro={
        <>
          <Link href="/admin/utilisateurs" className="underline underline-offset-2">
            Utilisateurs
          </Link>{" "}
          · {u.email}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5" data-testid="user-badges">
          <RoleBadge role={u.role} />
          {isStaffRole(u.role) && <TwoFactorBadge enabled={u.twoFactorEnabled} />}
          {u.deactivatedAt && (
            <span className="inline-flex items-center rounded-pill bg-[#fdecea] px-2.5 py-0.5 text-micro font-semibold text-error">
              Désactivé le {formatDate(u.deactivatedAt)}
            </span>
          )}
        </div>

        <section className="rounded-lg border border-line bg-white p-4 md:p-6">
          <h2 className="mb-3 text-title-s font-semibold">Compte</h2>
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {u.role === "OWNER" && u.listingCount > 0 && (
            <p className="mt-3 text-caption text-ink-muted">
              Un propriétaire garde ce rôle tant qu&apos;il a des biens : changez d&apos;abord leur propriétaire dans Biens.
            </p>
          )}
        </section>

        <RoleForm userId={u.id} role={u.role} self={self} />
        {!self && u.twoFactorEnabled && <ResetTwoFactorForm userId={u.id} />}
        {self ? (
          <p className="rounded-lg border border-line bg-white p-4 text-ink-muted md:p-6">
            Votre propre double authentification se gère dans{" "}
            <Link href="/admin/securite" className="font-semibold text-link underline underline-offset-2">
              Sécurité du compte
            </Link>
            .
          </p>
        ) : (
          <ActiveForm userId={u.id} active={!u.deactivatedAt} />
        )}

        {u.role === "OWNER" && (
          <OwnerDocuments
            ownerId={u.id}
            listings={ownerListings}
            kinds={OWNER_DOCUMENT_KINDS.map((k) => ({ value: k, label: OWNER_DOCUMENT_KIND_LABEL[k] }))}
            docs={docs.map((d) => ({
              id: d.id,
              title: d.title,
              kindLabel: OWNER_DOCUMENT_KIND_LABEL[d.kind],
              listingTitle: d.listingTitle,
              added: formatDateTime(new Date(d.createdAt)),
              size: `${Math.max(1, Math.round(d.sizeBytes / 1024))} Ko`,
            }))}
          />
        )}

        <section aria-labelledby="user-audit-title">
          <h2 id="user-audit-title" className="mb-3 text-title-s font-semibold">
            Historique
          </h2>
          <AuditList entries={audit} />
        </section>
      </div>
    </AdminPage>
  );
}
