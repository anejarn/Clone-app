import "server-only";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { EMAIL_REASON_LABEL } from "@/lib/admin/emails";
import { formatDate, formatDateTime } from "@/lib/format";
import type { BookingSource } from "@/lib/generated/prisma/enums";
import { notifier } from "@/lib/notifications";
import { db } from "../db";
import { STALE_AFTER_MS } from "./feeds";

/**
 * Alerts of the calendar synchronisation (Lot 7) to the organization's associés, through lib/notifications (no
 * e-mail or WhatsApp provider chosen yet: the default notifier sends nothing; the back-office banner is always there).
 * Messages hold no guest data: home, platform, nights, references.
 */

async function associates(organizationId: string) {
  return db.user.findMany({ where: { organizationId, role: "ADMIN", deactivatedAt: null }, select: { name: true, email: true, phone: true } });
}

export interface ConflictAlert {
  listingTitle: string;
  source: BookingSource;
  checkIn: Date;
  checkOut: Date;
  blockingSource: BookingSource;
  blockingRef: string | null;
}

export async function notifyConflicts(organizationId: string, conflicts: readonly ConflictAlert[]): Promise<void> {
  if (!conflicts.length) return;
  const to = await associates(organizationId);
  const lines = conflicts.map(
    (c) =>
      `- ${c.listingTitle} : ${SOURCE_LABEL[c.source]} du ${formatDate(c.checkIn)} au ${formatDate(c.checkOut)}, en conflit avec ${SOURCE_LABEL[c.blockingSource]}${c.blockingRef ? ` (${c.blockingRef})` : ""}`,
  );
  const text = `Double réservation détectée par la synchronisation des calendriers :\n${lines.join("\n")}\n\nOuvrez Synchronisation → Conflits dans l'espace équipe pour la résoudre.`;
  for (const u of to) {
    try {
      await notifier().send({ kind: "channel_conflict", to: u, subject: `Sigma : double réservation (${conflicts.length})`, text, channels: ["whatsapp", "email"] });
    } catch (e) {
      console.error(`conflict notification failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Tells the associés once about each import link that hasn't been read successfully for more than an hour (a broken
 * sync says nothing by itself); the flag resets at the next good read. Run by the worker every few minutes.
 */
export async function alertStaleFeeds(now = new Date()): Promise<{ alerted: number }> {
  const limit = new Date(now.getTime() - STALE_AFTER_MS);
  const feeds = await db.channelFeed.findMany({
    where: {
      importUrlEnc: { not: null },
      importEnabled: true,
      staleAlertedAt: null,
      OR: [{ lastSuccessAt: { lt: limit } }, { lastSuccessAt: null, importUrlSetAt: { lt: limit } }],
    },
    select: { id: true, organizationId: true, source: true, lastSuccessAt: true, lastError: true, listing: { select: { title: true } } },
  });
  const byOrg = new Map<string, typeof feeds>();
  for (const f of feeds) byOrg.set(f.organizationId, [...(byOrg.get(f.organizationId) ?? []), f]);
  for (const [organizationId, list] of byOrg) {
    const to = await associates(organizationId);
    const text = `Ces calendriers n'ont pas été lus depuis plus d'une heure : les réservations prises sur ces plateformes n'arrivent plus dans Sigma.\n${list
      .map((f) => `- ${f.listing.title} · ${SOURCE_LABEL[f.source]} : ${f.lastSuccessAt ? `dernière lecture réussie le ${formatDateTime(f.lastSuccessAt)}` : "jamais lu"}${f.lastError ? ` (${f.lastError})` : ""}`)
      .join("\n")}\n\nVérifiez les liens dans Biens → le bien → Plateformes.`;
    for (const u of to) {
      try {
        await notifier().send({ kind: "channel_stale", to: u, subject: `Sigma : synchronisation en panne (${list.length})`, text, channels: ["whatsapp", "email"] });
      } catch (e) {
        console.error(`stale feed notification failed: ${(e as Error).message}`);
      }
    }
    await db.channelFeed.updateMany({ where: { id: { in: list.map((f) => f.id) } }, data: { staleAlertedAt: now } });
  }
  return { alerted: feeds.length };
}

/**
 * Tells the associés that a booking e-mail couldn't be applied automatically and waits in Synchronisation → E-mails à
 * traiter (lot 7b): it may be a reservation whose dates are not blocked yet. Platform and reason only.
 */
export async function notifyEmailQueue(organizationId: string, items: readonly { source: BookingSource | null; reason: string }[]): Promise<void> {
  if (!items.length) return;
  const to = await associates(organizationId);
  const lines = items.map((i) => `- ${i.source ? SOURCE_LABEL[i.source] : "Plateforme inconnue"} : ${EMAIL_REASON_LABEL[i.reason] ?? i.reason}`);
  const text = `Un e-mail de réservation n'a pas pu être traité automatiquement : les dates ne sont peut-être pas bloquées.\n${lines.join("\n")}\n\nOuvrez Synchronisation → E-mails à traiter dans l'espace équipe.`;
  for (const u of to) {
    try {
      await notifier().send({ kind: "booking_email_pending", to: u, subject: `Sigma : e-mail de réservation à traiter (${items.length})`, text, channels: ["whatsapp", "email"] });
    } catch (e) {
      console.error(`e-mail queue notification failed: ${(e as Error).message}`);
    }
  }
}
