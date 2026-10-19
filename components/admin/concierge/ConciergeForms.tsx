"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import {
  createPartnerAction,
  createServiceAction,
  deletePartnerAction,
  deleteServiceAction,
  removeServicePhotoAction,
  setServicePhotoAction,
  updatePartnerAction,
  updateServiceAction,
  type ConciergeFormState,
} from "@/app/admin/conciergerie/actions";
import { Feedback } from "@/components/admin/guide/GuideForms";
import { PARTNER_CHANNEL_LABEL, PARTNER_CHANNELS, PRICING_MODEL_LABEL, PRICING_MODELS, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABEL } from "@/lib/concierge/catalog";
import { CONCIERGE_LIMITS, MAX_OPTIONS } from "@/lib/concierge/form";
import { marginBps } from "@/lib/concierge/pricing";
import { formatMad } from "@/lib/format";
import type { PartnerChannel, ServiceCategory, ServicePricingModel } from "@/lib/generated/prisma/enums";
import { GUEST_LOCALES, type GuestLocale } from "@/lib/i18n/locales";
import type { Localized } from "@/lib/i18n/localized";
import { bpsToPercent, centimesToDirhams, dirhamsToCentimes } from "@/lib/money";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/** Back-office forms of the conciergerie catalogue (Lot 4b). The server actions re-check everything. */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const area = "min-h-20 w-full rounded-sm border border-ink-faint bg-white px-3 py-2 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";
const LANG_NAME: Record<GuestLocale, string> = { fr: "français", es: "espagnol", en: "anglais" };

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-micro font-medium">
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

/** French field, Spanish and English under « Traductions » (French is shown when a language has none). */
function LocalizedInput({ name, label, value, errors, max, multiline, required }: { name: string; label: string; value: Localized; errors?: Record<string, string>; max: number; multiline?: boolean; required?: boolean }) {
  const others = GUEST_LOCALES.filter((l) => l !== "fr");
  const translated = others.filter((l) => value[l]);
  const control = (l: GuestLocale, p: object) =>
    multiline ? (
      <textarea {...p} lang={l} name={`${name}_${l}`} rows={3} maxLength={max} defaultValue={value[l] ?? ""} className={area} />
    ) : (
      <input {...p} lang={l} name={`${name}_${l}`} maxLength={max} defaultValue={value[l] ?? ""} required={required && l === "fr"} className={input} />
    );
  return (
    <div className="space-y-2">
      <Field label={`${label} (français)`} error={errors?.[`${name}_fr`]}>
        {(p) => control("fr", p)}
      </Field>
      <details className="rounded-sm border border-line-soft p-3" open={translated.length > 0}>
        <summary className="cursor-pointer text-caption font-semibold">
          {label} : traductions {translated.length ? `(${translated.map((l) => LANG_NAME[l]).join(", ")})` : "(sinon le français est affiché)"}
        </summary>
        <div className="mt-3 space-y-3">
          {others.map((l) => (
            <Field key={l} label={`${label} (${LANG_NAME[l]})`} error={errors?.[`${name}_${l}`]}>
              {(p) => control(l, p)}
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------- Partners ----------

export interface PartnerFormValues {
  id?: string;
  name: string;
  type: ServiceCategory;
  phone: string;
  whatsapp: string;
  email: string;
  preferredChannel: PartnerChannel;
  notes: string;
  active: boolean;
}

const EMPTY_PARTNER: PartnerFormValues = { name: "", type: "ACTIVITY", phone: "", whatsapp: "", email: "", preferredChannel: "WHATSAPP", notes: "", active: true };

export function PartnerForm({ partner }: { partner?: PartnerFormValues }) {
  const editing = !!partner?.id;
  const [state, action, pending] = useActionState<ConciergeFormState, FormData>(editing ? updatePartnerAction.bind(null, partner!.id!) : createPartnerAction, {});
  const p0 = partner ?? EMPTY_PARTNER;
  const v = (k: keyof PartnerFormValues) => state.values?.[k] ?? String(p0[k] ?? "");
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className={`${card} space-y-4`} data-testid="partner-form">
      <h2 className="text-title-s font-semibold">{editing ? "Modifier le partenaire" : "Ajouter un partenaire"}</h2>
      <Feedback state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nom du partenaire" error={e.name}>
          {(p) => <input {...p} name="name" required maxLength={CONCIERGE_LIMITS.partnerName} defaultValue={v("name")} className={input} />}
        </Field>
        <Field label="Activité" error={e.type}>
          {(p) => (
            <select {...p} name="type" defaultValue={v("type")} className={input}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SERVICE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="WhatsApp" hint="Format international, par exemple +212 6 00 00 00 00" error={e.whatsapp}>
          {(p) => <input {...p} name="whatsapp" type="tel" inputMode="tel" maxLength={CONCIERGE_LIMITS.phone} defaultValue={v("whatsapp")} className={input} />}
        </Field>
        <Field label="Téléphone" error={e.phone}>
          {(p) => <input {...p} name="phone" type="tel" inputMode="tel" maxLength={CONCIERGE_LIMITS.phone} defaultValue={v("phone")} className={input} />}
        </Field>
        <Field label="E-mail" error={e.email}>
          {(p) => <input {...p} name="email" type="email" inputMode="email" maxLength={CONCIERGE_LIMITS.email} defaultValue={v("email")} className={input} />}
        </Field>
        <Field label="Canal préféré" error={e.preferredChannel}>
          {(p) => (
            <select {...p} name="preferredChannel" defaultValue={v("preferredChannel")} className={input}>
              {PARTNER_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {PARTNER_CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Notes internes" hint="Conditions, horaires, personne à contacter… Jamais montrées aux voyageurs." error={e.notes}>
        {(p) => <textarea {...p} name="notes" rows={3} maxLength={CONCIERGE_LIMITS.partnerNotes} defaultValue={v("notes")} className={area} />}
      </Field>
      {editing && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={state.values ? state.values.active === "on" : p0.active} className="size-4 accent-brand" />
          Partenaire actif
        </label>
      )}
      <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
        {editing ? "Enregistrer le partenaire" : "Ajouter le partenaire"}
      </button>
    </form>
  );
}

export function DeleteButton({ kind, id, label, confirm }: { kind: "partner" | "service"; id: string; label: string; confirm: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirm)) return;
          start(async () => {
            const r = await (kind === "partner" ? deletePartnerAction(id) : deleteServiceAction(id));
            if (r?.error) setError(r.error);
          });
        }}
        className="inline-flex h-10 items-center gap-2 rounded-sm border border-error bg-white px-4 font-semibold text-error hover:bg-[#fdecea] disabled:opacity-60"
      >
        <Trash2 className="size-4" aria-hidden="true" />
        {label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-error">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------- Services ----------

export interface ServiceFormValues {
  id?: string;
  partnerId: string;
  category: ServiceCategory;
  title: Localized;
  description: Localized;
  availability: Localized;
  pricingModel: ServicePricingModel;
  salePriceCents: number | null;
  partnerPriceCents: number | null;
  options: { id: string; label: Localized; saleCents: number; partnerCents: number; perUnit: boolean }[];
  leadTimeHours: number;
  position: number;
  active: boolean;
}

const EMPTY_SERVICE: ServiceFormValues = {
  partnerId: "",
  category: "ACTIVITY",
  title: {},
  description: {},
  availability: {},
  pricingModel: "PER_PERSON",
  salePriceCents: null,
  partnerPriceCents: null,
  options: [],
  leadTimeHours: 24,
  position: 0,
  active: true,
};

const money = (c: number | null) => (c === null ? "" : centimesToDirhams(c));

/** Live margin of the typed prices (display only; the server computes the stored one). */
function MarginPreview({ sale, partner }: { sale: string; partner: string }) {
  const s = dirhamsToCentimes(sale);
  const p = dirhamsToCentimes(partner);
  if (s === null || p === null) return <p className="text-caption text-ink-muted">Marge : saisissez les deux prix.</p>;
  if (p > s) return <p className="text-caption font-semibold text-error">Marge négative : le prix partenaire dépasse le prix de vente.</p>;
  const bps = marginBps(s, s - p);
  return (
    <p className="text-caption" data-testid="margin-preview">
      Marge : <strong>{formatMad(s - p)}</strong>
      {bps !== null && ` (${bpsToPercent(bps)} % du prix de vente)`}
    </p>
  );
}

export function ServiceForm({ service, partners }: { service?: ServiceFormValues; partners: { id: string; name: string; active: boolean }[] }) {
  const editing = !!service?.id;
  const [state, action, pending] = useActionState<ConciergeFormState, FormData>(editing ? updateServiceAction.bind(null, service!.id!) : createServiceAction, {});
  const s0 = service ?? { ...EMPTY_SERVICE, partnerId: partners[0]?.id ?? "" };
  const sv = state.values;
  const e = state.fieldErrors ?? {};
  const [model, setModel] = useState<string>(sv?.pricingModel ?? s0.pricingModel);
  const [sale, setSale] = useState(sv?.salePrice ?? money(s0.salePriceCents));
  const [partner, setPartner] = useState(sv?.partnerPrice ?? money(s0.partnerPriceCents));
  const loc = (field: string, value: Localized): Localized => (sv ? Object.fromEntries(GUEST_LOCALES.map((l) => [l, sv[`${field}_${l}`] ?? ""])) : value);
  const rows = Array.from({ length: MAX_OPTIONS }, (_, i) => s0.options[i] ?? null);
  const quote = model === "ON_QUOTE";

  return (
    <form action={action} noValidate className={`${card} space-y-5`} data-testid="service-form">
      <Feedback state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Catégorie" error={e.category}>
          {(p) => (
            <select {...p} name="category" defaultValue={sv?.category ?? s0.category} className={input}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SERVICE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Partenaire" error={e.partnerId}>
          {(p) => (
            <select {...p} name="partnerId" defaultValue={sv?.partnerId ?? s0.partnerId} className={input}>
              {partners.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.active ? "" : " (désactivé)"}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <LocalizedInput name="title" label="Titre" value={loc("title", s0.title)} errors={e} max={CONCIERGE_LIMITS.title} required />
      <LocalizedInput name="description" label="Description" value={loc("description", s0.description)} errors={e} max={CONCIERGE_LIMITS.description} multiline />
      <LocalizedInput name="availability" label="Disponibilités" value={loc("availability", s0.availability)} errors={e} max={CONCIERGE_LIMITS.availability} />

      <fieldset className="space-y-4 rounded-md border border-line-soft p-4">
        <legend className="px-1 font-semibold">Prix (MAD)</legend>
        <Field label="Tarification" error={e.pricingModel}>
          {(p) => (
            <select {...p} name="pricingModel" value={model} onChange={(ev) => setModel(ev.target.value)} className={input}>
              {PRICING_MODELS.map((m) => (
                <option key={m} value={m}>
                  {PRICING_MODEL_LABEL[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {quote ? (
          <p className="text-caption text-ink-muted">Sur devis : pas de prix au catalogue, vous fixez le prix final sur chaque demande avant de la confirmer.</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Prix de vente (MAD)" hint="Ce que paie le voyageur, par unité de la tarification." error={e.salePrice}>
                {(p) => <input {...p} name="salePrice" inputMode="decimal" value={sale} onChange={(ev) => setSale(ev.target.value)} className={input} />}
              </Field>
              <Field label="Prix partenaire (MAD)" hint="Ce que la conciergerie paie au partenaire. Jamais montré au voyageur." error={e.partnerPrice}>
                {(p) => <input {...p} name="partnerPrice" inputMode="decimal" value={partner} onChange={(ev) => setPartner(ev.target.value)} className={input} />}
              </Field>
            </div>
            <MarginPreview sale={sale} partner={partner} />
          </>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-line-soft p-4">
        <legend className="px-1 font-semibold">Options (facultatif)</legend>
        <p className="text-caption text-ink-muted">Par exemple « Prise en charge à l&apos;aéroport », « Siège bébé ». Une option sans libellé français est ignorée.</p>
        {rows.map((o, i) => {
          const p = `option${i}_`;
          const val = (k: string, d: string) => sv?.[`${p}${k}`] ?? d;
          return (
            <div key={i} className="grid gap-3 rounded-sm bg-surface-2 p-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end" data-testid="option-row">
              <input type="hidden" name={`${p}id`} value={o?.id ?? ""} />
              <Field label={`Option ${i + 1} : libellé (français)`} error={e[`${p}label_fr`]}>
                {(pp) => <input {...pp} name={`${p}label_fr`} maxLength={CONCIERGE_LIMITS.optionLabel} defaultValue={val("label_fr", o?.label.fr ?? "")} className={input} />}
              </Field>
              <Field label={`Option ${i + 1} : prix de vente (MAD)`} error={e[`${p}sale`]}>
                {(pp) => <input {...pp} name={`${p}sale`} inputMode="decimal" defaultValue={val("sale", o ? money(o.saleCents) : "")} className={input} />}
              </Field>
              <Field label={`Option ${i + 1} : prix partenaire (MAD)`} error={e[`${p}partner`]}>
                {(pp) => <input {...pp} name={`${p}partner`} inputMode="decimal" defaultValue={val("partner", o ? money(o.partnerCents) : "")} className={input} />}
              </Field>
              <label className="flex h-11 items-center gap-2 text-caption">
                <input type="checkbox" name={`${p}perUnit`} defaultChecked={sv ? sv[`${p}perUnit`] === "on" : !!o?.perUnit} className="size-4 accent-brand" />
                Par unité
              </label>
              <div className="md:col-span-4 grid gap-3 md:grid-cols-2">
                {(["es", "en"] as const).map((l) => (
                  <Field key={l} label={`Option ${i + 1} : libellé (${LANG_NAME[l]})`} error={e[`${p}label_${l}`]}>
                    {(pp) => <input {...pp} lang={l} name={`${p}label_${l}`} maxLength={CONCIERGE_LIMITS.optionLabel} defaultValue={val(`label_${l}`, o?.label[l] ?? "")} className={input} />}
                  </Field>
                ))}
              </div>
            </div>
          );
        })}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Délai de prévenance (heures)" hint="Le voyageur ne peut pas demander le service plus tôt." error={e.leadTimeHours}>
          {(p) => <input {...p} name="leadTimeHours" inputMode="numeric" defaultValue={sv?.leadTimeHours ?? String(s0.leadTimeHours)} className={input} />}
        </Field>
        <Field label="Ordre d'affichage" hint="Les plus petits d'abord, dans la catégorie." error={e.position}>
          {(p) => <input {...p} name="position" inputMode="numeric" defaultValue={sv?.position ?? String(s0.position)} className={input} />}
        </Field>
        <label className="flex items-center gap-2 md:mt-6">
          <input type="checkbox" name="active" defaultChecked={sv ? sv.active === "on" : s0.active} className="size-4 accent-brand" />
          Proposé dans les guides d&apos;accueil
        </label>
      </div>
      <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
        {editing ? "Enregistrer le service" : "Créer le service"}
      </button>
    </form>
  );
}

export function ServicePhotoForm({ serviceId, photoUrl }: { serviceId: string; photoUrl: string | null }) {
  const [state, action, pending] = useActionState<ConciergeFormState, FormData>(setServicePhotoAction.bind(null, serviceId), {});
  const [removing, start] = useTransition();
  const [removeState, setRemoveState] = useState<ConciergeFormState>({});
  return (
    <div className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Photo</h2>
      <Feedback state={removeState.error || removeState.message ? removeState : state} />
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="Photo du service" className="aspect-[4/3] w-full max-w-xs rounded-md border border-line object-cover" />
      ) : (
        <p className="text-ink-muted">Pas encore de photo.</p>
      )}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <Field label="Choisir une photo" hint={`JPEG, PNG ou WebP, ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.`}>
          {(p) => <input {...p} name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="block text-body" />}
        </Field>
        <button type="submit" disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-sm bg-ink px-4 font-semibold text-white hover:bg-black disabled:opacity-60">
          <ImagePlus className="size-4" aria-hidden="true" />
          Enregistrer la photo
        </button>
        {photoUrl && (
          <button
            type="button"
            disabled={removing}
            onClick={() => start(async () => setRemoveState(await removeServicePhotoAction(serviceId)))}
            className="inline-flex h-10 items-center rounded-sm border border-ink bg-white px-4 font-semibold text-ink hover:bg-surface-2"
          >
            Retirer la photo
          </button>
        )}
      </form>
    </div>
  );
}
