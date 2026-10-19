import { UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { AuditList } from "@/components/admin/users/AuditList";
import { InvitationList } from "@/components/admin/users/InvitationList";
import { RoleBadge, TwoFactorBadge } from "@/components/admin/users/Badges";
import { isStaffRole, ROLE_LABEL, ROLES } from "@/lib/admin/users";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import type { Role } from "@/lib/generated/prisma/enums";
import { listInvitations, pageOrgUsers } from "@/lib/server/admin/users";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Utilisateurs" };

/** URL values of the role filter (French, readable in the address bar). */
const ROLE_PARAM: Record<string, Role> = {
  associe: "ADMIN",
  agent: "AGENT",
  proprietaire: "OWNER",
  voyageur: "GUEST",
};
const PARAM_OF: Record<Role, string> = Object.fromEntries(Object.entries(ROLE_PARAM).map(([k, v]) => [v, k])) as Record<Role, string>;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function Page({ searchParams }: PageProps<"/admin/utilisateurs">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { organizationId, user: me } = await requireAdminPage("/admin/utilisateurs");
  const sp = await searchParams;
  const raw = { q: one(sp.q).slice(0, 100), role: one(sp.role), page: one(sp.page) };
  const role = Object.hasOwn(ROLE_PARAM, raw.role) ? ROLE_PARAM[raw.role] : undefined;
  const requested = /^\d{1,5}$/.test(raw.page) ? Number(raw.page) : 1;
  const [members, invitations, audit] = await Promise.all([
    pageOrgUsers(organizationId, { role, q: raw.q || undefined }, requested),
    listInvitations(organizationId),
    recentAudit(organizationId, { take: 15 }),
  ]);
  const users = members.rows;
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (raw.q) p.set("q", raw.q);
    if (role) p.set("role", raw.role);
    if (n > 1) p.set("page", String(n));
    const qs = p.toString();
    return `/admin/utilisateurs${qs ? `?${qs}` : ""}`;
  };
  const pager = "inline-flex h-11 items-center rounded-sm border border-line bg-white px-4 font-medium hover:bg-surface-2";
  const open = invitations.filter((i) => i.status === "PENDING" || i.status === "EXPIRED");
  const select = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  return (
    <AdminPage
      title="Utilisateurs"
      intro="Les membres de l'organisation (associés, agents terrain, propriétaires) : invitations, rôles, double authentification et accès."
    >
      <div className="mb-4 flex justify-end">
        <Link
          href="/admin/utilisateurs/inviter"
          className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Inviter
        </Link>
      </div>

      {open.length > 0 && (
        <section className="mb-8" aria-labelledby="invitations-title">
          <h2 id="invitations-title" className="mb-3 text-title-s font-semibold">
            Invitations en cours
          </h2>
          <InvitationList
            items={open.map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role,
              status: i.status,
              expires: formatDateTime(i.expiresAt),
              invitedBy: i.invitedByName,
            }))}
          />
        </section>
      )}

      <section aria-labelledby="members-title">
        <h2 id="members-title" className="mb-3 text-title-s font-semibold">
          Membres
        </h2>
        <form
          method="get"
          role="search"
          aria-label="Filtrer les utilisateurs"
          className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
        >
          <label className="block">
            <span className="mb-1 block text-micro font-medium">Recherche</span>
            <input name="q" type="search" defaultValue={raw.q} placeholder="Nom, e-mail ou téléphone" className={select} />
          </label>
          <label className="block">
            <span className="mb-1 block text-micro font-medium">Rôle</span>
            <select name="role" defaultValue={role ? raw.role : ""} className={select}>
              <option value="">Tous</option>
              {ROLES.map((r) => (
                <option key={r} value={PARAM_OF[r]}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
            Filtrer
          </button>
        </form>

        <p className="mt-4 text-ink-muted" data-testid="user-count">
          {pluralize(members.total, "membre", "membres")}
          {members.pages > 1 && ` · page ${members.page} sur ${members.pages}`}
        </p>

        {users.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucun membre ne correspond à ces critères.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white" data-testid="user-rows">
            {users.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:gap-4 md:p-4" data-user-email={u.email}>
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/utilisateurs/${u.id}`} className="font-semibold hover:underline">
                    {u.name}
                    {u.id === me.id && <span className="font-normal text-ink-muted"> (vous)</span>}
                  </Link>
                  <p className="truncate text-caption text-ink-muted">
                    {u.email}
                    {u.phone && ` · ${u.phone}`}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {u.lastSignInAt ? `Dernière connexion le ${formatDateTime(u.lastSignInAt)}` : "Jamais connecté·e"}
                    {u.invitedAcceptedAt && ` · invitation acceptée le ${formatDate(u.invitedAcceptedAt)}`}
                    {u.role === "OWNER" && ` · ${pluralize(u.listingCount, "bien", "biens")}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  <RoleBadge role={u.role} />
                  {isStaffRole(u.role) && <TwoFactorBadge enabled={u.twoFactorEnabled} />}
                  {u.deactivatedAt && (
                    <span className="inline-flex items-center rounded-pill bg-[#fdecea] px-2.5 py-0.5 text-micro font-semibold text-error">
                      Désactivé
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {members.pages > 1 && (
          <nav aria-label="Pages des membres" className="mt-4 flex flex-wrap items-center gap-3" data-testid="user-pager">
            {members.page > 1 && (
              <Link href={pageHref(members.page - 1)} className={pager} rel="prev">
                ← Page précédente
              </Link>
            )}
            <span className="text-ink-muted">
              {(members.page - 1) * members.perPage + 1}–{Math.min(members.page * members.perPage, members.total)} sur {members.total}
            </span>
            {members.page < members.pages && (
              <Link href={pageHref(members.page + 1)} className={pager} rel="next">
                Page suivante →
              </Link>
            )}
          </nav>
        )}
      </section>

      <section className="mt-8" aria-labelledby="audit-title">
        <h2 id="audit-title" className="mb-3 text-title-s font-semibold">
          Journal des accès
        </h2>
        <AuditList entries={audit} />
      </section>
    </AdminPage>
  );
}
