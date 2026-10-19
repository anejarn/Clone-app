import {
  Bath,
  CalendarDays,
  Coffee,
  Compass,
  ConciergeBell,
  ExternalLink,
  KeyRound,
  Landmark,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  ScrollText,
  ShoppingBag,
  Siren,
  Sparkles,
  Store,
  Trees,
  Utensils,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/guide/CopyButton";
import { ServiceCatalog } from "@/components/guide/ServiceCatalog";
import { Countdown } from "@/components/guide/Countdown";
import { DocumentLang } from "@/components/guide/DocumentLang";
import { LogoMark } from "@/components/layout/Logo";
import { whatsappNumber } from "@/lib/admin/users";
import { formatMad } from "@/lib/format";
import { MOROCCO_EMERGENCY_NUMBERS } from "@/lib/guide/contacts";
import type { GuideRecommendationCategory, ServiceRequestStatus } from "@/lib/generated/prisma/enums";
import { GUEST_LOCALES, LOCALE_INFO, matchLocale, type GuestLocale } from "@/lib/i18n/locales";
import { fill, messages, type GuestMessages } from "@/lib/i18n/messages";
import { getGuestGuide, type GuestGuide } from "@/lib/server/guide/guest";

/**
 * The guest's welcome guide (Lot 4a), opened from the secret link the team sends (/guide/<token>, no account).
 * proxy.ts checks the link first, so an unknown, revoked or cancelled link gets a real 404 (this page streams from
 * the root layout's shell, which only holds the frame); the page renders without Suspense (instant = false), so
 * nothing of the guide is ever in a prerendered shell. The HTML is
 * dynamic (Cache-Control private, no-store, also set in next.config.ts), never indexed, never sent as a referrer,
 * and outside the team app's service worker scope (/admin/ma-journee). What it may show: lib/server/guide/guest.ts.
 */
export const instant = false;

export async function generateMetadata({ searchParams }: PageProps<"/guide/[token]">): Promise<Metadata> {
  const lang = matchLocale(String((await searchParams).lang ?? "")) ?? "fr";
  const m = messages(lang);
  return {
    title: m.meta.title,
    description: m.meta.description,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    // The link is a secret: never send it to another site (maps, recommendations) as a referrer.
    referrer: "no-referrer",
  };
}

export default async function Page({ params, searchParams }: PageProps<"/guide/[token]">) {
  await connection();
  const [{ token }, sp, h] = await Promise.all([params, searchParams, headers()]);
  // proxy.ts already checked the link (real 404, rate limit); checked again here, without counting failures twice.
  const guide = await getGuestGuide(token, { lang: sp.lang, acceptLanguage: h.get("accept-language") });
  if (!guide) notFound();
  return <GuideView guide={guide} token={token} />;
}

const CATEGORY_ICON: Record<GuideRecommendationCategory, LucideIcon> = {
  RESTAURANT: Utensils,
  CAFE: Coffee,
  HAMMAM: Bath,
  SOUK: Store,
  CULTURE: Landmark,
  NATURE: Trees,
  SHOPPING: ShoppingBag,
  OTHER: Compass,
};

const REQUEST_BADGE: Record<ServiceRequestStatus, string> = {
  NEW: "bg-surface-3 text-ink",
  SENT_TO_PARTNER: "bg-brand-tint text-brand-deep",
  CONFIRMED: "bg-[#e6f4e7] text-[#0b5e0f]",
  DONE: "bg-[#e6f4e7] text-[#0b5e0f]",
  CANCELLED: "bg-surface-3 text-ink-muted",
  REFUSED: "bg-[#fdecea] text-error",
};

function Section({ id, icon: Icon, title, children }: { id: string; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-lg border border-line bg-white p-5 shadow-e1 md:p-6">
      <h2 id={`${id}-title`} className="mb-4 flex items-center gap-2.5 text-title font-semibold">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Locked({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-md bg-surface-2 p-4 text-ink">
      <LockKeyhole className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function LanguageSwitcher({ locale, token, m }: { locale: GuestLocale; token: string; m: GuestMessages }) {
  return (
    <nav aria-label={m.language} className="flex gap-1 rounded-pill bg-white/15 p-1">
      {GUEST_LOCALES.map((l) => (
        // Plain links (no prefetch): each language is its own request, never cached.
        <a
          key={l}
          href={`/guide/${token}?lang=${l}`}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? "true" : undefined}
          title={LOCALE_INFO[l].nativeName}
          className={`rounded-pill px-3 py-1.5 text-caption font-semibold uppercase ${l === locale ? "bg-white text-brand-deep" : "text-white hover:bg-white/20"}`}
        >
          <span aria-hidden="true">{l}</span>
          <span className="sr-only">{LOCALE_INFO[l].nativeName}</span>
        </a>
      ))}
    </nav>
  );
}

function GuideView({ guide: g, token }: { guide: GuestGuide; token: string }) {
  const m = messages(g.locale);
  const wa = whatsappNumber(g.concierge.whatsapp);
  const hasContactBar = !!(g.concierge.phone || wa);
  const sections = [
    ["acces", m.nav.access],
    ["wifi", m.nav.wifi],
    ["regles", m.nav.rules],
    ["adresses", m.nav.recommendations],
    ["services", m.nav.services],
    ["contact", m.nav.contact],
  ] as const;
  const codesBefore = fill(m.codes.before, { date: g.access.opensDate, time: g.access.opensTime });
  const byCategory = new Map<GuideRecommendationCategory, GuestGuide["recommendations"]>();
  for (const r of g.recommendations) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);

  return (
    <div lang={g.locale} dir={g.dir} className={`min-h-dvh bg-surface-2 ${hasContactBar ? "pb-28" : "pb-10"}`} data-testid="guest-guide" data-state={g.access.state}>
      <DocumentLang lang={g.locale} dir={g.dir} />
      <header className="bg-brand text-white">
        <div className="mx-auto max-w-[680px] px-4 pb-8 pt-4 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <LogoMark className="size-7 text-white" />
              <span className="text-[22px] font-bold tracking-[-0.5px]">sigma</span>
            </span>
            <LanguageSwitcher locale={g.locale} token={token} m={m} />
          </div>
          <p className="mt-8 text-body-l text-white/85">{m.meta.title}</p>
          <h1 className="mt-1 text-display font-semibold">{g.guestFirstName ? fill(m.welcomeName, { name: g.guestFirstName }) : m.welcome}</h1>
          <p className="mt-2 text-title-s font-medium">{g.listing.title}</p>
          <p className="text-white/85">{g.listing.placeName}, {g.listing.city}</p>
          <div className="mt-5 grid gap-2 rounded-md bg-white/10 p-3 sm:grid-cols-3">
            <p className="flex items-center gap-2 sm:col-span-3">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              <span data-testid="guide-dates">{fill(m.stayDates, { from: g.stay.checkIn, to: g.stay.checkOut })}</span>
            </p>
            <p className="text-white/90">{fill(m.arrivalFrom, { time: g.stay.arrivalTime })}</p>
            <p className="text-white/90">{fill(m.departureBefore, { time: g.stay.departureTime })}</p>
          </div>
        </div>
      </header>

      <nav aria-label={m.nav.label} className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <ul className="no-scrollbar mx-auto flex max-w-[680px] gap-2 overflow-x-auto px-4 py-2.5 md:px-6">
          {sections.map(([id, label]) => (
            <li key={id} className="shrink-0">
              <a href={`#${id}`} className="inline-flex h-9 items-center rounded-pill border border-line px-3.5 text-caption font-semibold text-ink hover:border-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto max-w-[680px] space-y-4 px-4 py-5 md:px-6">
        <Section id="acces" icon={KeyRound} title={m.access.title}>
          <div className="space-y-5">
            <div>
              <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">{m.access.address}</p>
              <p className="mt-1 flex items-start gap-2 text-body-l">
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                <span>
                  {g.listing.address}
                  {!g.listing.address.includes(g.listing.placeName) && (
                    <>
                      <br />
                      {g.listing.placeName}, {g.listing.city}
                    </>
                  )}
                </span>
              </p>
              <a
                href={g.listing.mapsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
              >
                <Navigation className="size-4" aria-hidden="true" />
                {m.access.openMaps}
              </a>
            </div>
            {g.directions && (
              <div>
                <h3 className="font-semibold">{m.access.directions}</h3>
                <p className="mt-1 whitespace-pre-line text-ink">{g.directions}</p>
              </div>
            )}
            {g.accessInstructions && (
              <div>
                <h3 className="font-semibold">{m.access.instructions}</h3>
                <p className="mt-1 whitespace-pre-line text-ink">{g.accessInstructions}</p>
              </div>
            )}
            {g.photos.length > 0 && (
              <div>
                <h3 className="sr-only">{m.access.photos}</h3>
                <ul className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
                  {g.photos.map((p) => (
                    <li key={p.id} className="w-[72%] max-w-[300px] shrink-0 snap-start">
                      {/* Plain <img>: served only to this link's holder (never through the image optimizer or a cache). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/guide/${token}/photos/${p.id}`} alt={p.caption || m.access.photos} className="aspect-[4/3] w-full rounded-md border border-line object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      {p.caption && <p className="mt-1 text-caption text-ink-muted">{p.caption}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border-2 border-brand/30 bg-brand-tint/50 p-4" data-testid="guide-codes">
              <h3 className="mb-3 text-title-s font-semibold">{m.codes.title}</h3>
              {!g.hasCodes ? (
                <p className="text-ink">{m.codes.none}</p>
              ) : g.access.state === "BEFORE" ? (
                <Locked>
                  <p>{codesBefore}</p>
                  <Countdown until={g.access.opensAt} label={m.codes.countdown} units={{ days: m.codes.days, hours: m.codes.hours, minutes: m.codes.minutes }} />
                </Locked>
              ) : g.access.state === "AFTER" ? (
                <Locked>
                  <p>{m.codes.after}</p>
                </Locked>
              ) : (
                <ul className="space-y-2">
                  {(g.codes ?? []).map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 rounded-md bg-white p-3" data-testid="guide-code">
                      <div className="min-w-0">
                        <p className="font-semibold">{m.codes.kinds[c.kind]}</p>
                        {c.label && <p className="text-caption text-ink-muted">{c.label}</p>}
                        <p className="mt-1 break-all font-mono text-title font-semibold tracking-wider text-brand-deep" dir="ltr">
                          {c.value}
                        </p>
                      </div>
                      <CopyButton value={c.value} label={m.wifi.copy} copiedLabel={m.wifi.copied} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>

        <Section id="wifi" icon={Wifi} title={m.wifi.title}>
          {!g.wifi.configured ? (
            <p className="text-ink-muted">{m.wifi.none}</p>
          ) : (
            <dl className="space-y-3" data-testid="guide-wifi">
              {g.wifi.name && (
                <div>
                  <dt className="text-micro font-semibold uppercase tracking-wide text-ink-muted">{m.wifi.network}</dt>
                  <dd className="mt-0.5 break-all font-mono text-title-s font-semibold" dir="ltr">
                    {g.wifi.name}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-micro font-semibold uppercase tracking-wide text-ink-muted">{m.wifi.password}</dt>
                <dd className="mt-1">
                  {g.wifi.password ? (
                    <span className="flex items-center justify-between gap-3">
                      <span className="break-all font-mono text-title-s font-semibold" dir="ltr" data-testid="wifi-password">
                        {g.wifi.password}
                      </span>
                      <CopyButton value={g.wifi.password} label={m.wifi.copy} copiedLabel={m.wifi.copied} />
                    </span>
                  ) : (
                    <Locked>
                      <p>{g.access.state === "AFTER" ? m.wifi.hiddenAfter : g.access.state === "BEFORE" ? m.wifi.hiddenBefore : "—"}</p>
                    </Locked>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </Section>

        <Section id="regles" icon={ScrollText} title={m.rules.title}>
          {g.houseRules.length === 0 ? (
            <p className="text-ink-muted">{m.rules.none}</p>
          ) : (
            <ul className="space-y-2">
              {g.houseRules.map((r, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="adresses" icon={Sparkles} title={m.recommendations.title}>
          {byCategory.size === 0 ? (
            <p className="text-ink-muted">{m.recommendations.none}</p>
          ) : (
            <div className="space-y-5">
              {[...byCategory].map(([category, items]) => {
                const Icon = CATEGORY_ICON[category];
                return (
                  <div key={category}>
                    <h3 className="mb-2 flex items-center gap-2 font-semibold text-ink-muted">
                      <Icon className="size-4" aria-hidden="true" />
                      {m.recommendations.categories[category]}
                    </h3>
                    <ul className="space-y-2">
                      {items.map((r, i) => (
                        <li key={i} className="rounded-md border border-line-soft p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-semibold">{r.name}</p>
                            {r.url && (
                              <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-link underline underline-offset-2">
                                {m.recommendations.link}
                                <ExternalLink className="size-3.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                          {r.description && <p className="mt-1 text-ink-muted">{r.description}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section id="services" icon={ConciergeBell} title={m.services.title}>
          <div className="space-y-5">
            {g.services.requests.length > 0 && (
              <div data-testid="guest-requests">
                <h3 className="mb-2 font-semibold">{m.services.myRequests}</h3>
                <ul className="space-y-2">
                  {g.services.requests.map((r) => (
                    <li key={r.id} className="rounded-md border border-line p-3" data-testid="guest-request" data-status={r.status}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold">{r.title}</p>
                        <span className={`rounded-pill px-2.5 py-1 text-micro font-semibold ${REQUEST_BADGE[r.status]}`} data-testid="guest-request-status">
                          {m.services.status[r.status]}
                        </span>
                      </div>
                      <p className="text-caption text-ink-muted">
                        {fill(m.services.when, { date: r.date, time: r.time })} · {fill(m.services.reference, { ref: r.reference })}
                        {r.options.length > 0 && ` · ${r.options.join(", ")}`}
                      </p>
                      {r.status !== "CANCELLED" && r.status !== "REFUSED" && (
                        <p className="mt-1 text-caption">
                          {r.totalCents === null ? m.services.quotePending : fill(m.services.total, { price: formatMad(r.totalCents) })}
                          {" · "}
                          {r.paid ? m.services.paid : m.services.toPay}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-ink-muted">{m.services.intro}</p>
            <ServiceCatalog token={token} locale={g.locale} concierge={g.services} m={m.services} />
          </div>
        </Section>

        <Section id="contact" icon={Phone} title={m.contact.title}>
          {hasContactBar && (
            <div className="mb-5">
              <p className="font-semibold">{m.contact.concierge}</p>
              <p className="text-ink-muted">{m.contact.conciergeHint}</p>
              <p className="mt-1 font-mono" dir="ltr">
                {g.concierge.phone ?? g.concierge.whatsapp}
              </p>
            </div>
          )}
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Siren className="size-4 text-error" aria-hidden="true" />
            {m.contact.emergency}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-3" data-testid="guide-emergency">
            {MOROCCO_EMERGENCY_NUMBERS.map((e) => (
              <li key={e.number}>
                <a href={`tel:${e.number}`} className="flex items-center justify-between gap-2 rounded-md border border-line p-3 hover:border-ink">
                  <span>{m.contact[e.key]}</span>
                  <span className="text-title-s font-semibold tabular-nums">{e.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <p className="px-1 text-center text-caption text-ink-muted">{m.personalLink}</p>
      </main>

      {hasContactBar && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-[680px] gap-3 px-4 py-3 md:px-6" data-testid="guide-contact-bar">
            {g.concierge.phone && (
              <a href={`tel:${g.concierge.phone}`} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-sm border border-ink bg-white font-semibold text-ink hover:bg-surface-2">
                <Phone className="size-5" aria-hidden="true" />
                {m.contact.call}
              </a>
            )}
            {wa && (
              <a
                href={`https://wa.me/${wa}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-sm bg-brand font-semibold text-white hover:bg-brand-strong"
              >
                <MessageCircle className="size-5" aria-hidden="true" />
                {m.contact.whatsapp}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
