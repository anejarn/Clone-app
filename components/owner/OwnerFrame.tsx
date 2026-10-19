import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/layout/Logo";
import { OWNER_LOCALES, OWNER_LOCALE_INFO, type OwnerLocale, type OwnerMessages } from "@/lib/i18n/owner";
import { OwnerSignOut } from "./OwnerSignOut";

export type OwnerSection = "dashboard" | "listings" | "revenue" | "statements" | "documents" | "security";

const NAV: { key: OwnerSection; href: string }[] = [
  { key: "dashboard", href: "/proprietaire" },
  { key: "listings", href: "/proprietaire/biens" },
  { key: "revenue", href: "/proprietaire/revenus" },
  { key: "statements", href: "/proprietaire/releves" },
  { key: "documents", href: "/proprietaire/documents" },
  { key: "security", href: "/proprietaire/securite" },
];

/**
 * The owner portal's frame (Lot 6b), mobile first: brand row with the language switcher and sign-out, the sections as
 * a scrollable row of tabs, then the page. Everything inside carries the language and its direction (dir="rtl" in
 * Arabic): the html element stays French for the rest of the site.
 */
export function OwnerFrame({ locale, t, active, here, title, intro, children }: { locale: OwnerLocale; t: OwnerMessages; active: OwnerSection; here: string; title: string; intro?: ReactNode; children: ReactNode }) {
  const dir = OWNER_LOCALE_INFO[locale].dir;
  return (
    <div lang={locale} dir={dir} className="min-h-dvh bg-surface-2" data-testid="owner-portal">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 px-4 py-3 md:px-8">
          <Link href="/proprietaire" className="flex items-center gap-2 text-brand">
            <LogoMark className="size-7" />
            <span className="font-semibold text-ink">{t.brand}</span>
          </Link>
          <div className="flex items-center gap-1">
            <nav aria-label={t.language} className="flex items-center">
              {OWNER_LOCALES.map((l) => (
                <a
                  key={l}
                  href={`/proprietaire/langue?l=${l}&retour=${encodeURIComponent(here)}`}
                  lang={l}
                  hrefLang={l}
                  aria-current={l === locale ? "true" : undefined}
                  className={`inline-flex h-10 min-w-10 items-center justify-center rounded-sm px-2 text-caption font-semibold ${l === locale ? "bg-ink text-white" : "text-ink-muted hover:bg-surface-2"}`}
                >
                  {l === "ar" ? "ع" : l.toUpperCase()}
                  <span className="sr-only"> {OWNER_LOCALE_INFO[l].nativeName}</span>
                </a>
              ))}
            </nav>
            <OwnerSignOut label={t.signOut} />
          </div>
        </div>
        <nav aria-label={t.nav.label} className="mx-auto max-w-[1100px] overflow-x-auto px-4 md:px-8">
          <ul className="flex gap-1 pb-2">
            {NAV.map((n) => (
              <li key={n.key}>
                <Link
                  href={n.href}
                  aria-current={n.key === active ? "page" : undefined}
                  className={`inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-body font-medium ${n.key === active ? "bg-ink text-white" : "text-ink hover:bg-surface-2"}`}
                >
                  {t.nav[n.key]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-8 md:py-10">
        <h1 className="text-title-l font-semibold md:text-display">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-ink-muted">{intro}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

export function OwnerFallback() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-8" aria-busy="true">
      <p className="text-ink-muted">…</p>
    </main>
  );
}

/** A left-to-right run (amount, date, reference) inside text that may be right to left. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

export const card = "rounded-lg border border-line bg-white p-4 md:p-6";
