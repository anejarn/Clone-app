"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptSchema, fieldErrorsOf, isStaffRole, type FieldErrors } from "@/lib/admin/users";
import { TWO_FACTOR_SETUP_PATH } from "@/lib/admin/sections";
import type { Role } from "@/lib/generated/prisma/enums";
import { auth } from "@/lib/server/auth";
import { OWNER_PORTAL_PATH } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { acceptWithExistingAccount, acceptWithNewAccount } from "@/lib/server/invitations";

/**
 * Accepting an invitation (public page /invitation/<token>). The token is the only credential for a new account;
 * an existing account must be signed in. Rules: lib/server/invitations.ts.
 */

export interface AcceptState {
  error?: string;
  fieldErrors?: FieldErrors;
  values?: { name: string };
}

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** Staff go to double authentification enrollment (then /admin); owners to their portal (Lot 6b). */
function landing(role: Role): string {
  return isStaffRole(role) ? TWO_FACTOR_SETUP_PATH : OWNER_PORTAL_PATH;
}

export async function acceptWithNewAccountAction(token: string, _prev: AcceptState, form: FormData): Promise<AcceptState> {
  const values = { name: String(form.get("name") ?? "") };
  const parsed = acceptSchema.safeParse({
    name: values.name,
    password: String(form.get("password") ?? ""),
  });
  if (!parsed.success)
    return {
      error: "Corrigez les champs signalés.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    };
  if (typeof token !== "string") return { error: "Invitation introuvable." };
  let accepted: { email: string; role: Role };
  try {
    accepted = await acceptWithNewAccount(token, parsed.data);
  } catch (e) {
    return { ...failure(e), values };
  }
  // Signs the new account in (nextCookies sets the session cookie on this response).
  await auth.api.signInEmail({
    body: { email: accepted.email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect(landing(accepted.role));
}

export async function acceptWithExistingAccountAction(token: string): Promise<AcceptState> {
  if (typeof token !== "string") return { error: "Invitation introuvable." };
  // The session from the database, not the cookie copy: a revoked session can't accept.
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  if (!session) return { error: "Connectez-vous pour accepter l'invitation." };
  let accepted: { role: Role };
  try {
    accepted = await acceptWithExistingAccount(token, session.user.id);
  } catch (e) {
    return failure(e);
  }
  redirect(landing(accepted.role));
}
