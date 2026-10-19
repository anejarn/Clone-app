import "server-only";
import { cookies, headers } from "next/headers";
import { negotiateOwnerLocale, OWNER_LOCALE_COOKIE, ownerMessages, type OwnerLocale, type OwnerMessages } from "@/lib/i18n/owner";
import { requireOwnerPage, type Authorized } from "../authz";
import { db } from "../db";
import type { OwnerViewer } from "./portal";

export interface OwnerContext {
  access: Authorized;
  viewer: OwnerViewer;
  locale: OwnerLocale;
  t: OwnerMessages;
  organizationName: string;
}

/** Every portal page: the owner's access (requireOwnerPage), their language and the organization's name. */
export async function ownerContext(href: string): Promise<OwnerContext> {
  const access = await requireOwnerPage(href);
  const [jar, h, org] = await Promise.all([cookies(), headers(), db.organization.findUnique({ where: { id: access.organizationId }, select: { name: true } })]);
  const locale = negotiateOwnerLocale({ cookie: jar.get(OWNER_LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
  return { access, viewer: { userId: access.user.id, organizationId: access.organizationId }, locale, t: ownerMessages(locale), organizationName: org?.name ?? "Sigma" };
}
