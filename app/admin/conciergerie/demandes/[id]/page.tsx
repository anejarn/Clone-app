import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { FinalPriceForm, InternalNoteForm, PaymentForm, SendToPartner, StatusButtons } from "@/components/admin/concierge/RequestPanels";
import { RequestStatusBadge } from "@/components/admin/concierge/RequestStatusBadge";
import { AuditList } from "@/components/admin/users/AuditList";
import { PARTNER_CHANNEL_LABEL, PAYMENT_METHOD_LABEL, PRICING_MODEL_LABEL, QUANTITY_LABEL, SERVICE_CATEGORY_LABEL } from "@/lib/concierge/catalog";
import { formatDate, formatDateTime, formatMad } from "@/lib/format";
import { LOCALE_INFO, matchLocale } from "@/lib/i18n/locales";
import { bpsToPercent } from "@/lib/money";
import { formatTimeOfDay } from "@/lib/operations/schedule";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { getRequest } from "@/lib/server/concierge/requests";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Demande de service" };

const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`));

/** One guest request (associés): what was asked, the price snapshot and margin, sending to the partner, status, payment. */
export default function Page({ params }: PageProps<"/admin/conciergerie/demandes/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPage("/admin/conciergerie/demandes");
  const { id } = await params;
  // Another organization's request: not found, like an unknown one.
  const r = ID_RE.test(id) ? await getRequest(access, id) : null;
  if (!r) notFound();
  const audit = await recentAudit(access.organizationId, { targetId: r.id });
  const locale = matchLocale(r.guestLocale);

  return (
    <AdminPage title={`${r.title} · réf. ${r.reference}`}>
      <p className="mb-4">
        <Link href="/admin/conciergerie/demandes" className="font-semibold underline underline-offset-2">
          ← Demandes de services
        </Link>
      </p>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="req-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="req-title" className="text-title-s font-semibold">
                La demande
              </h2>
              <RequestStatusBadge status={r.status} />
            </div>
            <dl className="divide-y divide-line-soft">
              <Row label="Service">
                {r.title} ({SERVICE_CATEGORY_LABEL[r.category]}, {PRICING_MODEL_LABEL[r.pricingModel].toLowerCase()})
              </Row>
              <Row label="Date" testId="request-when">
                {day(r.serviceDate)} à {formatTimeOfDay(r.startMinutes)}
              </Row>
              <Row label="Personnes">{r.persons}</Row>
              {r.pricingModel !== "PER_PERSON" && <Row label={QUANTITY_LABEL[r.pricingModel]}>{r.quantity}</Row>}
              {r.options.length > 0 && <Row label="Options">{r.options.map((o) => o.label).join(", ")}</Row>}
              <Row label="Voyageur">
                <Link href={`/admin/reservations/${r.booking.id}`} className="underline underline-offset-2">
                  {r.booking.guestName ?? "Voyageur"}
                </Link>{" "}
                · {r.booking.listing.title}, du {day(r.booking.checkIn)} au {day(r.booking.checkOut)}
              </Row>
              <Row label="Téléphone donné">
                <a href={`tel:${r.contactPhone.replace(/[^\d+]/g, "")}`} dir="ltr" className="underline underline-offset-2">
                  {r.contactPhone}
                </a>
              </Row>
              <Row label="Langue">{locale ? LOCALE_INFO[locale].frenchName : r.guestLocale}</Row>
              {r.guestNote && <Row label="Note du voyageur">{r.guestNote}</Row>}
              <Row label="Reçue le">{formatDateTime(new Date(r.createdAt))}</Row>
              {r.sentAt && (
                <Row label="Transmise">
                  {formatDateTime(new Date(r.sentAt))} ({PARTNER_CHANNEL_LABEL[r.sentVia!]})
                </Row>
              )}
            </dl>
          </section>
          <SendToPartner
            requestId={r.id}
            partnerName={r.partner.name}
            preferred={r.partnerContact.preferredChannel}
            text={r.send.text}
            whatsapp={r.send.whatsapp}
            mailto={r.send.mailto}
            tel={r.send.tel}
            canSend={r.can.send}
            sentVia={r.sentVia}
          />
          <StatusButtons requestId={r.id} moves={r.can.moves} />
          <section aria-labelledby="journal-title">
            <h2 id="journal-title" className="mb-3 text-title-s font-semibold">
              Journal
            </h2>
            <AuditList entries={audit} />
          </section>
        </div>
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="price-title" data-testid="request-price">
            <h2 id="price-title" className="mb-3 text-title-s font-semibold">
              Prix {r.priceAdjusted ? "(fixé par l'équipe)" : "(au moment de la demande)"}
            </h2>
            <dl className="divide-y divide-line-soft">
              {r.unitSaleCents !== null && (
                <Row label="Prix unitaire">
                  {formatMad(r.unitSaleCents)} (partenaire {formatMad(r.unitPartnerCents ?? 0)})
                </Row>
              )}
              {r.options.map((o) => (
                <Row key={o.id} label={`Option : ${o.label}`}>
                  {formatMad(o.saleCents)} (partenaire {formatMad(o.partnerCents)}){o.perUnit ? " par unité" : ""}
                </Row>
              ))}
              <Row label="Total voyageur" testId="request-sale-total">
                {r.saleTotalCents === null ? "Devis à fixer" : formatMad(r.saleTotalCents)}
              </Row>
              <Row label="Total partenaire">{r.partnerTotalCents === null ? "—" : formatMad(r.partnerTotalCents)}</Row>
              <Row label="Marge" testId="request-margin">
                {r.marginCents === null ? "—" : `${formatMad(r.marginCents)}${r.marginBps === null ? "" : ` (${bpsToPercent(r.marginBps)} %)`}`}
              </Row>
              {r.paidAt && (
                <Row label="Payée" testId="request-paid">
                  {formatDateTime(new Date(r.paidAt))} · {PAYMENT_METHOD_LABEL[r.paymentMethod!]}
                </Row>
              )}
            </dl>
          </section>
          {r.can.editPrice && <FinalPriceForm requestId={r.id} saleTotalCents={r.saleTotalCents} partnerTotalCents={r.partnerTotalCents} />}
          <PaymentForm requestId={r.id} canRecord={r.can.recordPayment} canCancel={r.can.cancelPayment} />
          <InternalNoteForm requestId={r.id} note={r.internalNote} />
        </div>
      </div>
    </AdminPage>
  );
}
