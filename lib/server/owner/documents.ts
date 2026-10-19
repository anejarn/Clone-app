import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { OwnerDocumentKind, Role } from "@/lib/generated/prisma/enums";
import { fileStorage } from "@/lib/storage";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";
import { sniffReceiptType, type ReceiptType } from "../finance/expenses";

/**
 * Documents shared with an owner (Lot 6b): an associé uploads the management mandate, a contract, the loi 80-14
 * authorisation, the insurance… for an owner, optionally about one of their homes; the owner downloads them from the
 * portal (/proprietaire/documents). PDF, JPEG, PNG or WebP (type read from the bytes, never from the name), 5 MB at
 * most (the server actions' body limit), stored by lib/storage under owner-documents/<organizationId>/<ownerId>/…
 * with its SHA-256 (checked again at every download). Added and deleted by associés only, audited (kind, title, size:
 * never the file). An owner reads their own documents only; anything else is « introuvable » (404).
 */

export const MAX_OWNER_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const OWNER_DOCUMENT_KINDS = ["MANDATE", "CONTRACT", "LICENSE", "INSURANCE", "OTHER"] as const satisfies readonly OwnerDocumentKind[];
export const OWNER_DOCUMENT_KIND_LABEL: Record<OwnerDocumentKind, string> = {
  MANDATE: "Mandat de gestion",
  CONTRACT: "Contrat",
  LICENSE: "Autorisation 80-14",
  INSURANCE: "Assurance",
  OTHER: "Autre document",
};
const EXTENSION: Record<ReceiptType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface OwnerDocumentInput {
  ownerId: string;
  listingId: string | null;
  kind: OwnerDocumentKind;
  title: string;
}

export interface OwnerDocumentView {
  id: string;
  kind: OwnerDocumentKind;
  title: string;
  listingId: string | null;
  listingTitle: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export function checkOwnerDocument(bytes: Uint8Array): ReceiptType {
  if (bytes.byteLength === 0) throw new AppError(422, "INVALID_FILE", "Le fichier est vide.");
  if (bytes.byteLength > MAX_OWNER_DOCUMENT_BYTES) throw new AppError(422, "INVALID_FILE", `Fichier trop lourd : ${MAX_OWNER_DOCUMENT_BYTES / 1024 / 1024} Mo au maximum.`);
  const type = sniffReceiptType(bytes);
  if (!type) throw new AppError(422, "INVALID_FILE", "Format non accepté : PDF ou photo (JPEG, PNG, WebP).");
  return type;
}

export async function addOwnerDocument(actor: Authorized, input: OwnerDocumentInput, bytes: Uint8Array): Promise<{ id: string }> {
  const { organizationId } = actor;
  const title = input.title.trim();
  if (title.length < 2 || title.length > 160) throw new AppError(422, "INVALID_TITLE", "Indiquez un titre (2 à 160 caractères).");
  if (!(OWNER_DOCUMENT_KINDS as readonly string[]).includes(input.kind)) throw new AppError(422, "INVALID_KIND", "Type de document invalide.");
  const type = checkOwnerDocument(bytes);
  const owner = await db.user.findFirst({ where: { id: input.ownerId, organizationId, role: "OWNER" }, select: { id: true } });
  if (!owner) throw new AppError(404, "NOT_FOUND", "Propriétaire introuvable.");
  if (input.listingId) {
    const l = await db.listing.findFirst({ where: { id: input.listingId, organizationId, ownerId: owner.id }, select: { id: true } });
    if (!l) throw new AppError(404, "NOT_FOUND", "Bien introuvable pour ce propriétaire.");
  }
  const fileKey = `owner-documents/${organizationId}/${owner.id}/${randomBytes(16).toString("hex")}.${EXTENSION[type]}`;
  await fileStorage().put(fileKey, bytes, type);
  try {
    return await db.$transaction(async (tx) => {
      const d = await tx.ownerDocument.create({
        data: { organizationId, ownerId: owner.id, listingId: input.listingId, kind: input.kind, title, fileKey, contentType: type, sizeBytes: bytes.byteLength, sha256: sha256(bytes), uploadedById: actor.user.id },
        select: { id: true },
      });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "owner_document.added", targetType: "owner_document", targetId: d.id, details: { ownerId: owner.id, listingId: input.listingId, kind: input.kind, title, contentType: type, size: bytes.byteLength } });
      return d;
    });
  } catch (e) {
    await fileStorage().delete(fileKey);
    throw e;
  }
}

export async function deleteOwnerDocument(actor: Authorized, id: string): Promise<void> {
  const { organizationId } = actor;
  const key = await db.$transaction(async (tx) => {
    const d = await tx.ownerDocument.findFirst({ where: { id, organizationId }, select: { id: true, ownerId: true, kind: true, title: true, fileKey: true, sizeBytes: true } });
    if (!d) throw new AppError(404, "NOT_FOUND", "Document introuvable.");
    await tx.ownerDocument.delete({ where: { id: d.id } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "owner_document.deleted", targetType: "owner_document", targetId: d.id, details: { ownerId: d.ownerId, kind: d.kind, title: d.title, size: d.sizeBytes } });
    return d.fileKey;
  });
  await fileStorage().delete(key);
}

/** An owner's documents (newest first): for the associés (member page) and for the owner (portal). */
export async function listOwnerDocuments(organizationId: string, ownerId: string): Promise<OwnerDocumentView[]> {
  const rows = await db.ownerDocument.findMany({
    where: { organizationId, ownerId },
    select: { id: true, kind: true, title: true, listingId: true, contentType: true, sizeBytes: true, createdAt: true, listing: { select: { title: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, listingId: d.listingId, listingTitle: d.listing?.title ?? null, contentType: d.contentType, sizeBytes: d.sizeBytes, createdAt: d.createdAt.toISOString() }));
}

/** The file, for an associé of its organization or its owner; null (404) for anyone else. */
export async function readOwnerDocument(viewer: { userId: string; role: Role; organizationId: string }, id: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  if (viewer.role !== "ADMIN" && viewer.role !== "OWNER") return null;
  const d = await db.ownerDocument.findFirst({
    where: { id, organizationId: viewer.organizationId, ...(viewer.role === "OWNER" && { ownerId: viewer.userId }) },
    select: { fileKey: true, contentType: true, sha256: true, title: true },
  });
  if (!d) return null;
  const file = await fileStorage().get(d.fileKey);
  if (!file) throw new Error(`owner document file missing: ${id}`);
  if (sha256(file.bytes) !== d.sha256) throw new Error(`owner document file altered: ${id}`);
  const ext = d.fileKey.slice(d.fileKey.lastIndexOf(".") + 1);
  const base = d.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
  return { bytes: file.bytes, contentType: d.contentType, filename: `${base}.${ext}` };
}
