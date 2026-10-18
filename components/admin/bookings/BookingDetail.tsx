import type { ReactNode } from "react";
import { CHANNEL_LABEL, STATUS_LABEL } from "@/lib/admin/booking-sources";
import { parseDay } from "@/lib/admin/calendar";
import { formatDate, formatDateTime, formatPrice, pluralize } from "@/lib/format";
import type { StaffBookingView } from "@/lib/server/admin/bookings";
import { SourceBadge } from "./SourceBadge";

const day = (s: string) => formatDate(parseDay(s)!);

/** "2 adultes, 1 enfant, 1 animal". */
export function guestsLabel(b: Pick<StaffBookingView, "adults" | "children" | "infants" | "pets">): string {
  const parts = [pluralize(b.adults, "adulte", "adultes")];
  if (b.children) parts.push(pluralize(b.children, "enfant", "enfants"));
  if (b.infants) parts.push(pluralize(b.infants, "bébé", "bébés"));
  if (b.pets) parts.push(pluralize(b.pets, "animal", "animaux"));
  return parts.join(", ");
}

/** Who the booking is for, in one line: the guest's name, or the source for an owner block. */
export function bookingTitle(b: Pick<StaffBookingView, "source" | "guestName">): string {
  if (b.source === "OWNER") return "Blocage propriétaire";
  return b.guestName ?? "Voyageur sans nom";
}

/**
 * Everything the team reads about a booking: dates, nights, source and platform code, guest and contacts, and the
 * amounts when the view carries them (ADMIN only: an agent's view has no `amounts` at all). Same block in the
 * calendar's panel and on the booking's page.
 */
export function BookingDetail({ booking: b }: { booking: StaffBookingView }) {
  const owner = b.source === "OWNER";
  return (
    <div className="space-y-4" data-testid="booking-detail">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={b.source} />
        <span
          className={`rounded-pill px-2.5 py-0.5 text-caption font-medium ${b.status === "CANCELLED" ? "bg-[#fdecea] text-error" : "bg-brand-tint text-brand-deep"}`}
          data-status={b.status}
        >
          {owner && b.status === "CONFIRMED" ? "Actif" : STATUS_LABEL[b.status]}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Item label="Bien">
          {b.listingTitle}
          <span className="block text-caption text-ink-muted">{b.placeName}</span>
        </Item>
        <Item label="Dates">
          <span data-testid="booking-dates">
            du {day(b.checkIn)} au {day(b.checkOut)}
          </span>
          <span className="block text-caption text-ink-muted">{pluralize(b.nights, "nuit", "nuits")}</span>
        </Item>
        {b.externalRef && (
          <Item label="Référence de la plateforme">
            <span className="font-mono" data-testid="booking-ref">
              {b.externalRef}
            </span>
          </Item>
        )}
        {!owner && (
          <>
            <Item label="Voyageur">
              {b.guestName ?? <span className="text-ink-muted">Non communiqué</span>}
              {b.hasGuestAccount && <span className="block text-caption text-ink-muted">Compte voyageur Sigma</span>}
            </Item>
            <Item label="Téléphone">
              {b.guestPhone ? (
                <a href={`tel:${b.guestPhone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
                  {b.guestPhone}
                </a>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </Item>
            <Item label="E-mail">{b.guestEmail ? <span className="break-all">{b.guestEmail}</span> : <span className="text-ink-muted">—</span>}</Item>
            <Item label="Voyageurs">{guestsLabel(b)}</Item>
            {b.channel && <Item label="Reçue par">{CHANNEL_LABEL[b.channel]}</Item>}
          </>
        )}
        {"amounts" in b && !owner && (
          <Item label="Montant">
            {b.amounts ? (
              <span data-testid="booking-amounts">
                <span className="font-semibold">{formatPrice(b.amounts.totalCents)}</span>
                <span className="block text-caption text-ink-muted">
                  {formatPrice(b.amounts.nightlyCents)} / nuit{b.source !== "DIRECT" ? " (moyenne)" : ""} · ménage {formatPrice(b.amounts.cleaningFeeCents)}
                </span>
              </span>
            ) : (
              <span className="text-ink-muted">Pas encore connu</span>
            )}
          </Item>
        )}
        {b.note && (
          <Item label={owner ? "Motif" : "Note de l'équipe"} wide>
            <span className="whitespace-pre-line break-words">{b.note}</span>
          </Item>
        )}
        <Item label="Enregistrée le" wide>
          {formatDateTime(new Date(b.createdAt))}
          {b.cancelledAt && <span className="block text-caption text-error">Annulée le {formatDateTime(new Date(b.cancelledAt))}</span>}
        </Item>
      </dl>
    </div>
  );
}

function Item({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-micro font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
