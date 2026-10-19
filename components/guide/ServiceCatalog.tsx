"use client";

import { Clock, Info } from "lucide-react";
import { useActionState, useId, useState, type ReactNode } from "react";
import { requestServiceAction, type GuestRequestState } from "@/app/guide/[token]/actions";
import { lineTotals } from "@/lib/concierge/pricing";
import { formatMad } from "@/lib/format";
import type { ServiceCategory } from "@/lib/generated/prisma/enums";
import type { GuestLocale } from "@/lib/i18n/locales";
import type { GuestMessages } from "@/lib/i18n/messages";
import type { GuestConcierge, GuestService } from "@/lib/server/concierge/guest-view";

/**
 * The welcome guide's services (Lot 4b): the catalogue by category and the request form of the service picked. The
 * estimate shown is the sale price (lib/concierge/pricing.ts); the server checks and prices everything again
 * (app/guide/[token]/actions.ts). Texts come from the guest's catalog, passed by the page.
 */

type M = GuestMessages["services"];

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (s, k: string) => (k in v ? String(v[k]) : s));
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");
const input = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";

export function priceLine(s: Pick<GuestService, "pricingModel" | "unitPriceCents">, m: M): string {
  return s.pricingModel === "ON_QUOTE" || s.unitPriceCents === null ? m.pricing.ON_QUOTE : fill(m.pricing[s.pricingModel], { price: formatMad(s.unitPriceCents) });
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-caption font-semibold">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? `${id}-d` : undefined })}
      {(hint || error) && (
        <p id={`${id}-d`} className={`mt-1 text-caption ${error ? "text-error" : "text-ink-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function RequestForm({ token, locale, service, stay, m, onClose }: { token: string; locale: GuestLocale; service: GuestService; stay: GuestConcierge["stay"]; m: M; onClose: () => void }) {
  const [state, action, pending] = useActionState<GuestRequestState, FormData>(requestServiceAction.bind(null, token), {});
  const v = state.values ?? {};
  const [persons, setPersons] = useState(Number(v.persons) || 2);
  const [quantity, setQuantity] = useState(Number(v.quantity) || 1);
  const [chosen, setChosen] = useState<string[]>(state.optionIds ?? []);
  const perPerson = service.pricingModel === "PER_PERSON";
  const quote = service.pricingModel === "ON_QUOTE" || service.unitPriceCents === null;
  let estimate: number | null = null;
  if (!quote) {
    try {
      estimate =
        lineTotals({
          pricingModel: service.pricingModel,
          unitSaleCents: service.unitPriceCents,
          unitPartnerCents: 0,
          quantity: perPerson ? persons : quantity,
          persons,
          options: service.options.filter((o) => chosen.includes(o.id)).map((o) => ({ saleCents: o.priceCents, partnerCents: 0, perUnit: o.perUnit })),
        }).totals?.saleTotalCents ?? null;
    } catch {
      estimate = null;
    }
  }
  const e = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <div className="mt-3 rounded-md bg-brand-tint p-4" data-testid="service-request-sent">
        <p role="status" className="font-semibold text-brand-deep">
          {state.message}
        </p>
        <button type="button" onClick={onClose} className="mt-3 inline-flex h-10 items-center rounded-sm border border-ink bg-white px-4 font-semibold text-ink hover:bg-surface-2">
          {m.form.close}
        </button>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="mt-3 space-y-4 rounded-md border border-line bg-surface-2 p-4" data-testid="service-request-form" aria-label={fill(m.form.title, { service: service.title })}>
      <input type="hidden" name="serviceId" value={service.id} />
      <input type="hidden" name="lang" value={locale} />
      {state.error && (
        <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          {state.error}
        </p>
      )}
      <p className="text-caption text-ink-muted">{fill(m.form.stayHint, { from: jjmmaaaa(stay.firstDay), to: jjmmaaaa(stay.lastDay) })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.form.date} error={e.date}>
          {(p) => <input {...p} name="date" type="date" required min={stay.from} max={stay.to} defaultValue={v.date ?? stay.from} className={input} />}
        </Field>
        <Field label={m.form.time} error={e.time}>
          {(p) => <input {...p} name="time" type="time" required step={900} defaultValue={v.time ?? "10:00"} className={input} />}
        </Field>
        <Field label={m.form.persons} error={e.persons}>
          {(p) => <input {...p} name="persons" type="number" inputMode="numeric" min={1} max={50} value={persons} onChange={(ev) => setPersons(Math.max(1, Math.min(50, Number(ev.target.value) || 1)))} className={input} />}
        </Field>
        {!perPerson && (
          <Field label={m.form.quantity[service.pricingModel]} error={e.quantity}>
            {(p) => <input {...p} name="quantity" type="number" inputMode="numeric" min={1} max={50} value={quantity} onChange={(ev) => setQuantity(Math.max(1, Math.min(50, Number(ev.target.value) || 1)))} className={input} />}
          </Field>
        )}
      </div>
      {service.options.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-caption font-semibold">{m.form.options}</legend>
          <ul className="space-y-1.5">
            {service.options.map((o) => (
              <li key={o.id}>
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    name="options"
                    value={o.id}
                    checked={chosen.includes(o.id)}
                    onChange={(ev) => setChosen((c) => (ev.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)))}
                    className="mt-1 size-4 accent-brand"
                  />
                  <span>
                    {o.label}
                    {o.priceCents > 0 && <span className="text-ink-muted"> (+{formatMad(o.priceCents)}{o.perUnit && !quote ? ` × ${perPerson ? persons : quantity}` : ""})</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {e.options && <p className="mt-1 text-caption text-error">{e.options}</p>}
        </fieldset>
      )}
      <Field label={m.form.note} hint={e.note ? undefined : m.form.noteHint} error={e.note}>
        {(p) => <textarea {...p} name="note" rows={3} maxLength={1000} defaultValue={v.note ?? ""} className="min-h-20 w-full rounded-sm border border-ink-faint bg-white px-3 py-2 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink" />}
      </Field>
      <Field label={m.form.phone} error={e.phone}>
        {(p) => <input {...p} name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={40} defaultValue={v.phone ?? ""} dir="ltr" className={input} />}
      </Field>
      <div className="rounded-md bg-white p-3" data-testid="service-estimate">
        {quote ? (
          <p className="font-medium">{m.form.quote}</p>
        ) : (
          <p className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{m.form.estimate}</span>
            <span className="text-title-s font-semibold tabular-nums">{estimate === null ? "—" : formatMad(estimate)}</span>
          </p>
        )}
        <p className="mt-1 flex items-start gap-1.5 text-caption text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {m.form.payment}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
          {m.form.submit}
        </button>
        <button type="button" onClick={onClose} className="inline-flex h-11 items-center rounded-sm border border-ink bg-white px-4 font-semibold text-ink hover:bg-surface-2">
          {m.form.close}
        </button>
      </div>
    </form>
  );
}

export function ServiceCatalog({ token, locale, concierge, m }: { token: string; locale: GuestLocale; concierge: GuestConcierge; m: M }) {
  const [open, setOpen] = useState<string | null>(null);
  const byCategory = new Map<ServiceCategory, GuestService[]>();
  for (const s of concierge.services) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
  if (concierge.services.length === 0) return <p className="text-ink-muted">{m.none}</p>;
  return (
    <div className="space-y-5" data-testid="service-catalog">
      {[...byCategory].map(([category, items]) => (
        <div key={category}>
          <h3 className="mb-2 font-semibold text-ink-muted">{m.categories[category]}</h3>
          <ul className="space-y-3">
            {items.map((s) => (
              <li key={s.id} className="rounded-md border border-line-soft p-3" data-testid="guest-service">
                <div className="flex gap-3">
                  {s.hasPhoto && (
                    // Plain <img>: served only to this link's holder (never through the image optimizer or a cache).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/guide/${token}/services/${s.id}`} alt={m.photo} className="size-20 shrink-0 rounded-sm border border-line object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-body font-medium text-brand-deep" data-testid="service-price">
                      {priceLine(s, m)}
                    </p>
                    {s.description && <p className="mt-1 whitespace-pre-line text-ink-muted">{s.description}</p>}
                    {s.availability && <p className="mt-1 text-caption text-ink-muted">{s.availability}</p>}
                    {s.leadTimeHours > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-caption text-ink-muted">
                        <Clock className="size-3.5" aria-hidden="true" />
                        {fill(m.leadTime, { hours: s.leadTimeHours })}
                      </p>
                    )}
                  </div>
                </div>
                {concierge.open && open !== s.id && (
                  <button
                    type="button"
                    onClick={() => setOpen(s.id)}
                    aria-label={`${m.request} — ${s.title}`}
                    className="mt-3 inline-flex h-10 items-center rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
                  >
                    {m.request}
                  </button>
                )}
                {concierge.open && open === s.id && <RequestForm token={token} locale={locale} service={s} stay={concierge.stay} m={m} onClose={() => setOpen(null)} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
