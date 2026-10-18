"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fieldErrorsOf, invitationText, inviteSchema, roleSchema, whatsappShareLink, type FieldErrors } from "@/lib/admin/users";
import { formatDateTime } from "@/lib/format";
import { notifier } from "@/lib/notifications";
import {
  changeUserRole,
  createInvitation,
  organizationName,
  resendInvitation,
  resetUserTwoFactor,
  revokeInvitation,
  setUserActive,
  type IssuedInvitation,
} from "@/lib/server/admin/users";
import { auth } from "@/lib/server/auth";
import { requireAdminAction, type Authorized } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Utilisateurs (ADMIN only). Every action checks the session, the role and double authentification again
 * (requireAdminAction), and only touches the caller's organization: ids come from the browser and are looked up
 * within that organization (404 otherwise). Rules and audit trail: lib/server/admin/users.ts.
 */

export interface IssuedLink {
  email: string;
  link: string;
  whatsapp: string;
  expires: string;
  /** False while no e-mail/WhatsApp provider is configured (lib/notifications): the admin shares the link. */
  delivered: boolean;
}

export interface InviteState {
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
  issued?: IssuedLink;
}

export interface ActionState {
  error?: string;
  message?: string;
}

export interface LinkResult {
  error?: string;
  issued?: IssuedLink;
}

const USER_NOT_FOUND = "Utilisateur introuvable.";
const INVITATION_NOT_FOUND = "Invitation introuvable.";

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** The public origin of the links: BETTER_AUTH_URL (configured), else the request's host. */
async function origin() {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Builds the link shown once to the admin, and hands the message to the notifier (no provider yet: not sent). */
async function share(access: Authorized, inv: IssuedInvitation): Promise<IssuedLink> {
  const link = `${await origin()}/invitation/${inv.token}`;
  const message = invitationText({
    organizationName: await organizationName(access.organizationId),
    role: inv.role,
    link,
    inviterName: access.user.name,
  });
  const result = await notifier().send({
    kind: "invitation",
    to: { email: inv.email, phone: inv.phone },
    ...message,
    channels: ["email", "whatsapp"],
  });
  return {
    email: inv.email,
    link,
    whatsapp: whatsappShareLink(message.text, inv.phone),
    expires: formatDateTime(inv.expiresAt),
    delivered: result.delivered,
  };
}

export async function inviteUserAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const access = await requireAdminAction("/admin/utilisateurs").catch(failure);
  if ("error" in access) return access;
  const values = {
    email: String(form.get("email") ?? ""),
    role: String(form.get("role") ?? ""),
    phone: String(form.get("phone") ?? ""),
  };
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success)
    return {
      error: "Corrigez les champs signalés.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    };
  try {
    const inv = await createInvitation(access, parsed.data);
    const issued = await share(access, inv);
    refresh();
    return { issued };
  } catch (e) {
    return { ...failure(e), values };
  }
}

export async function resendInvitationAction(invitationId: string): Promise<LinkResult> {
  const access = await requireAdminAction("/admin/utilisateurs").catch(failure);
  if ("error" in access) return access;
  if (typeof invitationId !== "string" || !ID_RE.test(invitationId)) return { error: INVITATION_NOT_FOUND };
  try {
    const issued = await share(access, await resendInvitation(access, invitationId));
    refresh();
    return { issued };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionState> {
  const access = await requireAdminAction("/admin/utilisateurs").catch(failure);
  if ("error" in access) return access;
  if (typeof invitationId !== "string" || !ID_RE.test(invitationId)) return { error: INVITATION_NOT_FOUND };
  try {
    await revokeInvitation(access, invitationId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Invitation révoquée." };
}

export async function changeRoleAction(userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAdminAction("/admin/utilisateurs").catch(failure);
  if ("error" in access) return access;
  if (typeof userId !== "string" || !ID_RE.test(userId)) return { error: USER_NOT_FOUND };
  const role = roleSchema.safeParse(form.get("role"));
  if (!role.success) return { error: "Rôle inconnu." };
  let result: { changed: boolean; self: boolean };
  try {
    result = await changeUserRole(access, userId, role.data);
  } catch (e) {
    return failure(e);
  }
  // Demoting oneself signs oneself out (sessions revoked).
  if (result.self && result.changed) redirect("/login");
  refresh();
  return {
    message: result.changed ? "Rôle modifié. La personne a été déconnectée de ses appareils." : "Le rôle était déjà celui-ci.",
  };
}

export async function resetTwoFactorAction(userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAdminAction("/admin/utilisateurs").catch(failure);
  if ("error" in access) return access;
  if (typeof userId !== "string" || !ID_RE.test(userId)) return { error: USER_NOT_FOUND };
  if (form.get("confirm") !== "on") return { error: "Cochez la case pour confirmer." };
  const password = form.get("password");
  if (typeof password !== "string" || !password) return { error: "Saisissez votre mot de passe." };
  // The acting admin's own password, checked by Better Auth against their session.
  try {
    await auth.api.verifyPassword({
      body: { password },
      headers: await headers(),
    });
  } catch {
    return { error: "Mot de passe incorrect." };
  }
  try {
    await resetUserTwoFactor(access, userId);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return {
    message: "Double authentification réinitialisée : la personne la réactivera à sa prochaine connexion.",
  };
}

export async function setUserActiveAction(userId: string, active: boolean, _prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAdminAction("/admin/utilisateurs").catch(failure);
  if ("error" in access) return access;
  if (typeof userId !== "string" || !ID_RE.test(userId)) return { error: USER_NOT_FOUND };
  if (typeof active !== "boolean") return { error: "Action inconnue." };
  if (!active && form.get("confirm") !== "on") return { error: "Cochez la case pour confirmer." };
  try {
    await setUserActive(access, userId, active);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return {
    message: active ? "Compte réactivé." : "Compte désactivé : la personne ne peut plus se connecter.",
  };
}
