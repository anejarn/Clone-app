import "server-only";
import { db } from "../../db";

/**
 * Minimal retention of the booking e-mails (Lot 7b), run daily by the worker (job inbound-email-purge):
 * - the raw message (rawEnc) is deleted INBOUND_EMAIL_RETENTION_DAYS after it was received, whatever its status;
 * - the extracted details (detailsEnc: guest name, subject, excerpt…) too, except for a message still waiting in the
 *   queue (they are deleted at the first run after it is handled and older than the delay);
 * - the row itself (no personal data left: platform, kind, code, nights, outcome) is deleted after
 *   INBOUND_EMAIL_ROW_DAYS.
 * The delays are placeholders to confirm with Sigma's lawyer (loi 09-08, CNDP declaration).
 */

const DAY = 86_400_000;
export const INBOUND_EMAIL_RETENTION_DAYS = 30;
export const INBOUND_EMAIL_ROW_DAYS = 400;
/** Done price reminders are kept this long (the list of what was reported to the platforms). */
export const PRICE_REMINDER_DONE_DAYS = 180;

export async function purgeInboundEmails(now = new Date()): Promise<{ raw: number; details: number; rows: number }> {
  const limit = new Date(now.getTime() - INBOUND_EMAIL_RETENTION_DAYS * DAY);
  const raw = await db.inboundEmail.updateMany({ where: { rawEnc: { not: null }, receivedAt: { lt: limit } }, data: { rawEnc: null, purgedAt: now } });
  const details = await db.inboundEmail.updateMany({
    where: { detailsEnc: { not: null }, receivedAt: { lt: limit }, status: { not: "PENDING" }, OR: [{ resolvedAt: null }, { resolvedAt: { lt: limit } }] },
    data: { detailsEnc: null, purgedAt: now },
  });
  const rows = await db.inboundEmail.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - INBOUND_EMAIL_ROW_DAYS * DAY) }, status: { not: "PENDING" } } });
  return { raw: raw.count, details: details.count, rows: rows.count };
}

export async function purgeDonePriceReminders(now = new Date()): Promise<{ deleted: number }> {
  const r = await db.priceReminder.deleteMany({ where: { doneAt: { lt: new Date(now.getTime() - PRICE_REMINDER_DONE_DAYS * DAY) } } });
  return { deleted: r.count };
}
