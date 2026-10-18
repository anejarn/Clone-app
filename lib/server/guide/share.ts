import "server-only";
import { headers } from "next/headers";
import type { GuideLinkView } from "@/components/admin/guide/GuideForms";
import { whatsappShareLink } from "@/lib/admin/users";
import { formatDateTime } from "@/lib/format";
import { guideUrl } from "@/lib/guide/token";
import { DEFAULT_GUEST_LOCALE } from "@/lib/i18n/locales";
import { fill, messages } from "@/lib/i18n/messages";
import type { StaffGuideLink } from "./admin";

/** The public origin of the links: BETTER_AUTH_URL (configured), else the request's host. */
export async function publicOrigin(): Promise<string> {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/**
 * What the booking page shows of the guide link: the URL (with the guest's language when set), and a wa.me link
 * with the message in the guest's language (no WhatsApp provider: the associé sends it from their phone).
 */
export async function guideLinkView(link: StaffGuideLink, guest: { name: string | null; phone: string | null; listingTitle: string }): Promise<GuideLinkView> {
  const url = link.token ? guideUrl(await publicOrigin(), link.token, link.guestLocale) : null;
  const m = messages(link.guestLocale ?? DEFAULT_GUEST_LOCALE);
  const firstName = guest.name?.trim().split(/\s+/)[0] ?? "";
  return {
    status: link.status,
    link: url,
    whatsapp: url ? whatsappShareLink(fill(m.share.text, { name: firstName, listing: guest.listingTitle, link: url }).replace(/\s+,/, ","), guest.phone) : null,
    createdAt: link.createdAt ? formatDateTime(link.createdAt) : null,
    guestLocale: link.guestLocale,
    eligible: link.eligible,
  };
}
