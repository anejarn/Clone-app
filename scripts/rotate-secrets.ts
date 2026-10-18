/**
 * Re-encrypts every welcome-guide secret (access codes, Wi-Fi passwords, guide link tokens) with the current
 * ACCESS_CODES_KEY (`pnpm secrets:rotate`). Rotation: set the new key in ACCESS_CODES_KEY, the old one in
 * ACCESS_CODES_PREVIOUS_KEYS, restart the app, run this, then remove the old key. Idempotent; values already on the
 * current key are left alone. A value no key can read is reported and left as it is.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { keyringFromEnv, needsRotation, rotateSecret, type SecretContext } from "../lib/secrets/access-codes";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ring = keyringFromEnv();

let rotated = 0;
let failed = 0;
function rotate(envelope: string, ctx: SecretContext, what: string): string | null {
  if (!needsRotation(envelope, ring)) return null;
  try {
    rotated += 1;
    return rotateSecret(envelope, ctx, ring);
  } catch (e) {
    rotated -= 1;
    failed += 1;
    console.error(`${what}: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  for (const c of await prisma.guideAccessCode.findMany({ select: { id: true, organizationId: true, listingId: true, valueEnc: true } })) {
    const v = rotate(c.valueEnc, { organizationId: c.organizationId, listingId: c.listingId, purpose: "access-code" }, `code ${c.id}`);
    if (v) await prisma.guideAccessCode.update({ where: { id: c.id }, data: { valueEnc: v } });
  }
  for (const g of await prisma.listingGuide.findMany({ where: { wifiPasswordEnc: { not: null } }, select: { listingId: true, organizationId: true, wifiPasswordEnc: true } })) {
    const v = rotate(g.wifiPasswordEnc!, { organizationId: g.organizationId, listingId: g.listingId, purpose: "wifi" }, `wifi ${g.listingId}`);
    if (v) await prisma.listingGuide.update({ where: { listingId: g.listingId }, data: { wifiPasswordEnc: v } });
  }
  for (const l of await prisma.guideLink.findMany({ select: { bookingId: true, organizationId: true, tokenEnc: true } })) {
    const v = rotate(l.tokenEnc, { organizationId: l.organizationId, bookingId: l.bookingId, purpose: "guide-token" }, `link ${l.bookingId}`);
    if (v) await prisma.guideLink.update({ where: { bookingId: l.bookingId }, data: { tokenEnc: v } });
  }
  console.log(`Key ${ring.current.id}: ${rotated} secrets re-encrypted, ${failed} unreadable.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
