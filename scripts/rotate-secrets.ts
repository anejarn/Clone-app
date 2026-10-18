/**
 * Re-encrypts every welcome-guide secret (access codes, Wi-Fi passwords, guide link tokens) and the iCal feeds'
 * export tokens and import URLs (Lot 7) with the current
 * ACCESS_CODES_KEY, and every traveller's identity fiche and document scan (Lot 5) with the current IDENTITY_DOCS_KEY
 * (`pnpm secrets:rotate`). Rotation: set the new key in ACCESS_CODES_KEY / IDENTITY_DOCS_KEY, the old one in
 * ACCESS_CODES_PREVIOUS_KEYS / IDENTITY_DOCS_PREVIOUS_KEYS, restart the app, run this, then remove the old key.
 * Idempotent; values already on the current key are left alone. A value no key can read is reported and left as it
 * is. A re-encrypted scan is written under a new storage key (the key is bound to the file), then the old one goes.
 * Runs with the react-server condition (package.json) to use the app's file store.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { keyringFromEnv, needsRotation, rotateSecret, type SecretContext } from "../lib/secrets/access-codes";
import { decryptDocument, decryptIdentity, documentNeedsRotation, encryptDocument, encryptIdentity, identityKeyringFromEnv, identityNeedsRotation } from "../lib/secrets/identity";
import { fileStorage } from "../lib/storage";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ring = keyringFromEnv();
const identityRing = identityKeyringFromEnv();

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
  // iCal feeds (Lot 7): export tokens and import URLs.
  for (const f of await prisma.channelFeed.findMany({ select: { id: true, organizationId: true, listingId: true, source: true, exportTokenEnc: true, importUrlEnc: true } })) {
    const t = rotate(f.exportTokenEnc, { organizationId: f.organizationId, listingId: f.listingId, purpose: "ical-export-token", scope: f.source }, `export ${f.id}`);
    const u = f.importUrlEnc ? rotate(f.importUrlEnc, { organizationId: f.organizationId, listingId: f.listingId, purpose: "ical-import-url", scope: f.source }, `import ${f.id}`) : null;
    if (t || u) await prisma.channelFeed.update({ where: { id: f.id }, data: { ...(t && { exportTokenEnc: t }), ...(u && { importUrlEnc: u }) } });
  }
  // Identity fiches and scans (Lot 5).
  for (const t of await prisma.traveler.findMany({ select: { id: true, organizationId: true, bookingId: true, identityEnc: true } })) {
    if (!identityNeedsRotation(t.identityEnc, identityRing)) continue;
    const ctx = { organizationId: t.organizationId, bookingId: t.bookingId, travelerId: t.id };
    try {
      await prisma.traveler.update({ where: { id: t.id }, data: { identityEnc: encryptIdentity(decryptIdentity(t.identityEnc, ctx, identityRing), ctx, identityRing) } });
      rotated += 1;
    } catch (e) {
      failed += 1;
      console.error(`traveller ${t.id}: ${(e as Error).message}`);
    }
  }
  const storage = fileStorage();
  for (const d of await prisma.travelerDocument.findMany({ select: { id: true, organizationId: true, travelerId: true, storageKey: true, traveler: { select: { bookingId: true } } } })) {
    try {
      const file = await storage.get(d.storageKey);
      if (!file || !documentNeedsRotation(file.bytes, identityRing)) continue;
      const clear = decryptDocument(file.bytes, { organizationId: d.organizationId, travelerId: d.travelerId, storageKey: d.storageKey }, identityRing);
      const key = `identity/${d.organizationId}/${d.traveler.bookingId}/${randomBytes(16).toString("hex")}.enc`;
      await storage.put(key, encryptDocument(clear, { organizationId: d.organizationId, travelerId: d.travelerId, storageKey: key }, identityRing), "application/octet-stream");
      await prisma.travelerDocument.update({ where: { id: d.id }, data: { storageKey: key } });
      await storage.delete(d.storageKey);
      rotated += 1;
    } catch (e) {
      failed += 1;
      console.error(`document ${d.id}: ${(e as Error).message}`);
    }
  }
  console.log(`Keys ${ring.current.id} (guide) and ${identityRing.current.id} (identity): ${rotated} values re-encrypted, ${failed} unreadable.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
