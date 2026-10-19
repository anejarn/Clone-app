import { isOwnerLocale, OWNER_LOCALE_COOKIE } from "@/lib/i18n/owner";

/**
 * GET /proprietaire/langue?l=fr|ar|en&retour=/proprietaire/… → keeps the owner portal's language in a cookie (a
 * year, this site only, not a secret) and goes back to the page (303). Only portal pages are accepted as `retour`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const l = url.searchParams.get("l");
  const back = url.searchParams.get("retour") ?? "/proprietaire";
  const target = /^\/proprietaire(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_-]*)?$/.test(back) && !back.includes("//") ? back : "/proprietaire";
  const headers = new Headers({ Location: new URL(target, url).toString(), "Cache-Control": "no-store" });
  if (isOwnerLocale(l)) headers.append("Set-Cookie", `${OWNER_LOCALE_COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
}
