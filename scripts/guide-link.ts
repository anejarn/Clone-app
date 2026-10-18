/**
 * Issues a new welcome guide link for a booking and prints it (`pnpm guide:link <bookingId> [fr|es|en]`), for staff
 * and development; the usual way is the booking's page in Réservations. Regenerating: the booking's previous link
 * stops working. Refused for owner blocks and cancelled stays. Recorded in the audit trail as done by the system.
 * Uses ACCESS_CODES_KEY like the app (the token is also kept encrypted, for the booking page).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { generateGuideToken, guideUrl, hashGuideToken } from "../lib/guide/token";
import { isGuestLocale } from "../lib/i18n/locales";
import { encryptSecret } from "../lib/secrets/access-codes";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const [bookingId, lang] = process.argv.slice(2);
  if (!bookingId) throw new Error("Usage: pnpm guide:link <bookingId> [fr|es|en]");
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, organizationId: true, source: true, status: true, guestLocale: true } });
  if (!b) throw new Error(`Réservation ${bookingId} introuvable.`);
  if (b.source === "OWNER") throw new Error("Un blocage propriétaire n'a pas de guide d'accueil.");
  if (b.status !== "CONFIRMED") throw new Error("Réservation annulée : pas de guide d'accueil.");
  const token = generateGuideToken();
  const data = {
    tokenHash: hashGuideToken(token),
    tokenEnc: encryptSecret(token, { organizationId: b.organizationId, bookingId: b.id, purpose: "guide-token" }),
    createdById: null,
    createdAt: new Date(),
    revokedAt: null,
  };
  await prisma.$transaction([
    prisma.guideLink.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, organizationId: b.organizationId, ...data }, update: data }),
    prisma.auditLog.create({ data: { organizationId: b.organizationId, actorId: null, action: "guide.link_issued", targetType: "booking", targetId: b.id, details: { via: "script" } } }),
  ]);
  const locale = isGuestLocale(lang) ? lang : isGuestLocale(b.guestLocale) ? b.guestLocale : null;
  console.log(guideUrl(process.env.BETTER_AUTH_URL ?? "http://localhost:3000", token, locale));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
