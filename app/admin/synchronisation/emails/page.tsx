import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { DropEmailForm, EmailQueueActions, InboundAddressActions } from "@/components/admin/channels/EmailForms";
import { SyncTabs } from "@/components/admin/channels/SyncTabs";
import { amountValue } from "@/lib/admin/booking-form";
import { PLATFORM_SOURCES, SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { EMAIL_KIND_LABEL, EMAIL_REASON_LABEL, EMAIL_STATUS_LABEL, emailResultText } from "@/lib/admin/emails";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { syncAlerts } from "@/lib/server/channels/conflicts";
import { inboundAddress } from "@/lib/server/channels/email/address";
import { INBOUND_EMAIL_RETENTION_DAYS } from "@/lib/server/channels/email/purge";
import { listInboundEmails, queueListingOptions, type InboundEmailView, type QueueFilter } from "@/lib/server/channels/email/queue";
import { publicOrigin } from "@/lib/server/guide/share";

export const metadata: Metadata = { title: "E-mails de réservation" };

/**
 * Synchronisation → E-mails à traiter (ADMIN, Lot 7b): the organization's receiving address (for the receiving service,
 * to be chosen), « Déposer un e-mail », the messages waiting for an associé and those already handled.
 */
export default function Page({ searchParams }: PageProps<"/admin/synchronisation/emails">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const FILTERS: { key: QueueFilter; label: string; param: string }[] = [
  { key: "PENDING", label: "À traiter", param: "" },
  { key: "PROCESSED", label: "Traités", param: "traites" },
  { key: "IGNORED", label: "Ignorés", param: "ignores" },
];

const day = (s: string | null) => (s ? formatDate(new Date(`${s}T00:00:00Z`)) : "?");

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId } = await requireAdminPage("/admin/synchronisation");
  const vue = (await searchParams).vue;
  const filter = FILTERS.find((f) => f.param === (typeof vue === "string" ? vue : ""))?.key ?? "PENDING";
  const [alerts, address, emails, listings] = await Promise.all([
    syncAlerts(organizationId),
    inboundAddress(organizationId, await publicOrigin()),
    listInboundEmails(organizationId, filter),
    queueListingOptions(organizationId),
  ]);
  return (
    <AdminPage title="E-mails de réservation" intro="Les e-mails de confirmation, de modification et d'annulation des plateformes complètent iCal : ils bloquent les dates tout de suite et apportent le code, le voyageur et le montant.">
      <SyncTabs current="emails" alerts={alerts} />
      <div className="space-y-6">
        <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="address-title">
          <h2 id="address-title" className="text-title-s font-semibold">
            Adresse de réception
          </h2>
          <p className="mt-1 text-ink-muted">
            <strong>Le service de réception d&apos;e-mails n&apos;est pas encore choisi</strong> (choix des associés, avec la question du transfert de données de la loi 09-08). Une fois
            choisi, il recevra les e-mails transférés depuis les comptes des plateformes et les enverra à cette adresse secrète (webhook, message brut ou JSON {"{ raw }"}). Les messages
            bruts sont chiffrés et effacés après {INBOUND_EMAIL_RETENTION_DAYS} jours.
          </p>
          <div className="mt-3">
            <InboundAddressActions url={address.url} />
            {address.issuedAt && <p className="mt-2 text-caption text-ink-muted">Créée le {formatDateTime(address.issuedAt)}.</p>}
          </div>
        </section>

        <DropEmailForm />

        <section aria-labelledby="queue-title">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="queue-title" className="text-title-s font-semibold">
              {filter === "PENDING" ? "E-mails à traiter" : filter === "PROCESSED" ? "E-mails traités" : "E-mails ignorés"}
            </h2>
            <nav aria-label="Filtre des e-mails" className="flex gap-3 text-caption font-semibold">
              {FILTERS.map((f) => (
                <Link key={f.key} href={f.param ? `?vue=${f.param}` : "?"} aria-current={f.key === filter ? "page" : undefined} className={f.key === filter ? "underline underline-offset-4" : "text-ink-muted hover:text-ink"}>
                  {f.label}
                </Link>
              ))}
            </nav>
          </div>
          {emails.length === 0 ? (
            <p className="rounded-lg border border-line bg-white p-4 text-ink-muted" data-testid="no-emails">
              {filter === "PENDING" ? "Aucun e-mail en attente." : "Aucun e-mail."}
            </p>
          ) : (
            <ul className="space-y-3" data-testid="email-list">
              {emails.map((e) => (
                <EmailItem key={e.id} e={e} listings={listings} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminPage>
  );
}

function EmailItem({ e, listings }: { e: InboundEmailView; listings: { id: string; title: string }[] }) {
  const d = e.details;
  const pending = e.status === "PENDING";
  const amount = d?.amount ? `${(d.amount.cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${d.amount.currency} (${d.amount.kind === "PAYOUT" ? "versement à Sigma" : "payé par le voyageur"})` : null;
  return (
    <li className={`rounded-lg bg-white p-4 md:p-5 ${pending ? "border-2 border-[#8a5a00]" : "border border-line"}`} data-testid="inbound-email" data-status={e.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {e.source ? SOURCE_LABEL[e.source] : "Plateforme inconnue"} · {EMAIL_KIND_LABEL[e.kind]}
          {e.externalRef && <> · réf. {e.externalRef}</>}
        </p>
        <p className="text-caption text-ink-muted">
          {EMAIL_STATUS_LABEL[e.status]} · reçu le {formatDateTime(e.receivedAt)} {e.via === "MANUAL" ? "(déposé)" : ""}
        </p>
      </div>
      {d?.subject && <p className="mt-1 break-words">« {d.subject} »</p>}
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-caption sm:grid-cols-2">
        <div>
          <dt className="inline text-ink-muted">Séjour : </dt>
          <dd className="inline">{e.checkIn || e.checkOut ? `du ${day(e.checkIn)} au ${day(e.checkOut)}` : "dates non lues"}</dd>
        </div>
        <div>
          <dt className="inline text-ink-muted">Bien : </dt>
          <dd className="inline">{e.listingTitle ?? (d?.listing.name ? `« ${d.listing.name} » sur la plateforme (non reconnu)` : "non indiqué")}</dd>
        </div>
        {d?.guestName && (
          <div>
            <dt className="inline text-ink-muted">Voyageur : </dt>
            <dd className="inline">
              {d.guestName}
              {d.adults ? ` · ${d.adults} adulte(s)${d.children ? `, ${d.children} enfant(s)` : ""}` : ""}
            </dd>
          </div>
        )}
        {amount && (
          <div>
            <dt className="inline text-ink-muted">Montant : </dt>
            <dd className="inline">{amount}</dd>
          </div>
        )}
        <div>
          <dt className="inline text-ink-muted">Expéditeur : </dt>
          <dd className="inline">
            {e.senderDomain ?? "?"}
            {d?.forwarded ? " (transféré)" : ""}
          </dd>
        </div>
      </dl>
      <p className={`mt-2 font-medium ${pending ? "text-[#5c3c00]" : ""}`}>
        {pending ? `À traiter : ${EMAIL_REASON_LABEL[e.reason ?? ""] ?? "à vérifier"}.` : emailResultText(e)}
        {e.bookingId && (
          <>
            {" "}
            <Link href={`/admin/reservations/${e.bookingId}`} className="underline underline-offset-2">
              Voir la réservation
            </Link>
          </>
        )}
        {e.conflictId && (
          <>
            {" "}
            <Link href="/admin/synchronisation/conflits" className="underline underline-offset-2">
              Voir le conflit
            </Link>
          </>
        )}
      </p>
      {d?.excerpt && (
        <details className="mt-2">
          <summary className="cursor-pointer text-caption font-semibold">Texte de l&apos;e-mail</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-2 p-3 text-caption">{d.excerpt}</pre>
        </details>
      )}
      {!d && e.purged && <p className="mt-2 text-caption text-ink-muted">Contenu effacé (conservation limitée).</p>}
      {pending && (
        <EmailQueueActions
          emailId={e.id}
          listings={listings}
          candidates={d?.candidates ?? []}
          canRemember={!!e.source && !!(d?.listing.platformId || d?.listing.name)}
          sources={PLATFORM_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
          defaults={{
            listingId: e.listingId ?? (d?.candidates?.length === 1 ? d.candidates[0] : ""),
            source: e.source ?? "",
            externalRef: e.externalRef ?? "",
            checkIn: e.checkIn ?? "",
            checkOut: e.checkOut ?? "",
            guestName: d?.guestName ?? "",
            adults: String(d?.adults ?? 1),
            children: String(d?.children ?? 0),
            total: d?.amount?.currency === "MAD" ? amountValue(d.amount.cents) : "",
          }}
        />
      )}
    </li>
  );
}
