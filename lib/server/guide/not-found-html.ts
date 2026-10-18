import { GUEST_LOCALES } from "@/lib/i18n/locales";
import { messages } from "@/lib/i18n/messages";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The plain 404 page proxy.ts answers for a guide link that opens nothing (before the page renders, so the status
 * really is 404): self-contained, in every guest language, no script.
 */
export function guideNotFoundHtml(): string {
  const sections = GUEST_LOCALES.map((l) => {
    const m = messages(l);
    return `<section lang="${l}"><h${l === "fr" ? 1 : 2}>${esc(m.notFound.title)}</h${l === "fr" ? 1 : 2}><p>${esc(m.notFound.body)}</p></section>`;
  }).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>Guide introuvable · Sigma</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Roboto,"Helvetica Neue",sans-serif;color:#222;max-width:36rem;margin:0 auto;padding:3rem 1.5rem;line-height:1.4}h1,h2{margin:1.5rem 0 .25rem;font-size:1.25rem}h1{font-size:1.6rem}p{color:#6a6a6a;margin:0}b{color:#3550a8;font-size:2rem}</style></head><body><main data-testid="guide-not-found"><b aria-hidden="true">Σ</b>${sections}</main></body></html>`;
}
