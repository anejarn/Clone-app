import { z } from "zod";
import type { Role } from "@/lib/generated/prisma/enums";
import { CONTROL_RE } from "@/lib/server/schemas";

/**
 * Utilisateurs (back-office, ADMIN only): labels, invitation rules and form validation shared by the pages, the
 * server actions (app/admin/utilisateurs/actions.ts, app/invitation/[token]/actions.ts) and the server code
 * (lib/server/admin/users.ts, lib/server/invitations.ts). No database or Node-only code here.
 */

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Associé (admin)",
  AGENT: "Agent terrain",
  OWNER: "Propriétaire",
  GUEST: "Voyageur",
};

/** Every role an ADMIN may give to a member of the organization, in the order the forms list them. */
export const ROLES: readonly Role[] = ["ADMIN", "AGENT", "OWNER", "GUEST"];

/** Who can be invited: a guest needs no invitation (public sign-up). */
export const INVITABLE_ROLES = ["OWNER", "AGENT", "ADMIN"] as const satisfies readonly Role[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** Roles that must turn on double authentification before the back-office (lib/server/authz.ts). */
export const isStaffRole = (role: Role) => role === "ADMIN" || role === "AGENT";

/** An invitation link works for this many days, then must be resent. */
export const INVITATION_DAYS = 7;

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: "En attente",
  ACCEPTED: "Acceptée",
  REVOKED: "Révoquée",
  EXPIRED: "Expirée",
};

/** Accepted and revoked are final; an open invitation is expired once expiresAt is past. */
export function invitationStatus(inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InvitationStatus {
  if (inv.acceptedAt) return "ACCEPTED";
  if (inv.revokedAt) return "REVOKED";
  return inv.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "PENDING";
}

export function invitationExpiry(now = new Date(), days = INVITATION_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/**
 * Digits for a wa.me link: international format without "+" or "00". A Moroccan number typed the local way
 * (06…, 07…, 05…: ten digits) gets the country code 212. Null when it can't be a phone number.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^0[5-7]\d{8}$/.test(d)) d = `212${d.slice(1)}`;
  d = d.replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

/** "Partager sur WhatsApp": a plain wa.me link with the text prefilled (no API, nothing is sent by Sigma). */
export function whatsappShareLink(text: string, phone?: string | null): string {
  const n = whatsappNumber(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

/** The text of an invitation (WhatsApp share, and later e-mail/WhatsApp providers through lib/notifications). */
export function invitationText(opts: { organizationName: string; role: Role; link: string; inviterName?: string | null }): {
  subject: string;
  text: string;
} {
  const who = opts.inviterName ? `${opts.inviterName} vous invite` : "Vous êtes invité·e";
  const role = ROLE_LABEL[opts.role].toLowerCase();
  return {
    subject: `Invitation à rejoindre ${opts.organizationName}`,
    text: `Bonjour, ${who} à rejoindre ${opts.organizationName} en tant que ${role}. Créez votre accès avec ce lien personnel (valable ${INVITATION_DAYS} jours, une seule fois) : ${opts.link}`,
  };
}

export const USER_LIMITS = {
  name: 80,
  email: 254,
  phone: 30,
  passwordMin: 8,
  passwordMax: 128,
} as const;

const email = z.string().trim().toLowerCase().max(USER_LIMITS.email, "Adresse e-mail trop longue").pipe(z.email("Adresse e-mail invalide"));

const phone = z
  .string()
  .trim()
  .max(USER_LIMITS.phone, "Téléphone trop long")
  .refine((s) => s === "" || /^[+\d][\d\s().-]{5,}$/.test(s), "Téléphone invalide (chiffres, espaces, + au début)")
  .transform((s) => s || null);

export const inviteSchema = z.object({
  email,
  role: z.enum(INVITABLE_ROLES, "Choisissez un rôle"),
  phone,
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const roleSchema = z.enum(["ADMIN", "AGENT", "OWNER", "GUEST"], "Rôle inconnu");

export const acceptSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nom : champ obligatoire")
    .max(USER_LIMITS.name, "Nom trop long")
    .refine((s) => !CONTROL_RE.test(s), "Nom : caractères non autorisés"),
  password: z
    .string()
    .min(USER_LIMITS.passwordMin, `Le mot de passe doit contenir au moins ${USER_LIMITS.passwordMin} caractères.`)
    .max(USER_LIMITS.passwordMax, "Mot de passe trop long"),
});
export type AcceptInput = z.infer<typeof acceptSchema>;

export type FieldErrors = Partial<Record<string, string>>;

/** zod issues → first message per field. */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "form");
    out[k] ??= issue.message;
  }
  return out;
}
