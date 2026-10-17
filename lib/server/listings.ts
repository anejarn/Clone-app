import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "./db";
import { AppError } from "./errors";

/**
 * Rules for writing listings (the back-office, Lot 2, creates and edits them). The database enforces the same
 * rules (listings_owner_role_check trigger, the (ownerId, organizationId) foreign key, the commission and
 * minimum-stay CHECKs); checking here first gives the team a clear message instead of a constraint error.
 */

/** The owner (propriétaire) of a listing of `orgId`: a user with the OWNER role in that same organization. */
export async function requireListingOwner(orgId: string, ownerId: string, tx: Prisma.TransactionClient = db): Promise<string> {
  const owner = await tx.user.findFirst({ where: { id: ownerId, organizationId: orgId, role: "OWNER" }, select: { id: true } });
  if (!owner) throw new AppError(422, "INVALID_OWNER", "Le propriétaire doit être un compte propriétaire de l'organisation.");
  return owner.id;
}

/** Terms a new listing starts with: the organization's default commission, a management mandate, one night minimum. */
export async function defaultListingTerms(orgId: string, tx: Prisma.TransactionClient = db) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { defaultCommissionBps: true } });
  return { commissionBps: org.defaultCommissionBps, managementType: "MANAGED" as const, minNights: 1 };
}
