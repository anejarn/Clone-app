"use client";

import { Check, Copy, Eye, EyeOff, ImagePlus, Link2, MessageCircle, RefreshCw, Trash2 } from "lucide-react";
import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import {
  addCodeAction,
  addRecommendationAction,
  deleteCodeAction,
  deleteGuidePhotoAction,
  deleteRecommendationAction,
  revealSecretsAction,
  saveConciergeAction,
  saveGuideTextsAction,
  saveWifiAction,
  updateCodeAction,
  updateRecommendationAction,
  uploadGuidePhotoAction,
  type GuideFormState,
} from "@/app/admin/biens/guide-actions";
import { revealTaskCodesAction } from "@/app/admin/mes-taches/actions";
import { issueGuideLinkAction, revokeGuideLinkAction, setGuestLocaleAction, type GuideLinkState } from "@/app/admin/reservations/guide-actions";
import { Button } from "@/components/ui/Button";
import { ACCESS_CODE_KIND_LABEL, ACCESS_CODE_KINDS, GUIDE_LIMITS, RECOMMENDATION_CATEGORIES, RECOMMENDATION_CATEGORY_LABEL } from "@/lib/guide/form";
import type { GuideAccessCodeKind, GuideRecommendationCategory } from "@/lib/generated/prisma/enums";
import { GUEST_LOCALES, LOCALE_INFO, type GuestLocale } from "@/lib/i18n/locales";
import type { Localized } from "@/lib/i18n/localized";
import type { RevealedSecrets } from "@/lib/server/guide/admin";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/** Back-office forms of the welcome guide (Lot 4a). Server actions re-check everything (app/admin/biens/guide-actions.ts). */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const area =
  "min-h-24 w-full rounded-sm border border-ink-faint bg-white px-3 py-2 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
export const card = "rounded-lg border border-line bg-white p-4 md:p-6";

export function Feedback({ state }: { state: { error?: string; message?: string; fieldErrors?: Record<string, string> } }) {
  if (state.error) {
    return (
      <div role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
        <p>{state.error}</p>
        {state.fieldErrors && (
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(state.fieldErrors).map(([k, m]) => (
              <li key={k}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
        {state.message}
      </p>
    );
  }
  return null;
}

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

const LANG_NAME: Record<GuestLocale, string> = { fr: "français", es: "espagnol", en: "anglais" };

/** A text in French, with its Spanish and English versions folded under « Traductions ». */
function LocalizedArea({ name, label, value, errors, rows = 4, frenchOverride }: { name: string; label: string; value: Localized; errors?: Record<string, string>; rows?: number; frenchOverride?: ReactNode }) {
  const others = GUEST_LOCALES.filter((l) => l !== "fr");
  const translated = others.filter((l) => value[l]);
  return (
    <div className="space-y-2">
      {frenchOverride ?? (
        <Field label={`${label} (français)`} error={errors?.[`${name}_fr`]}>
          {(p) => <textarea {...p} name={`${name}_fr`} rows={rows} maxLength={GUIDE_LIMITS.text} defaultValue={value.fr ?? ""} className={area} />}
        </Field>
      )}
      <details className="rounded-sm border border-line-soft p-3" open={translated.length > 0}>
        <summary className="cursor-pointer text-caption font-semibold">
          Traductions {translated.length ? `(${translated.map((l) => LANG_NAME[l]).join(", ")})` : "(sinon le français est affiché)"}
        </summary>
        <div className="mt-3 space-y-3">
          {others.map((l) => (
            <Field key={l} label={`${label} (${LANG_NAME[l]})`} error={errors?.[`${name}_${l}`]}>
              {(p) => <textarea {...p} lang={l} name={`${name}_${l}`} rows={rows} maxLength={GUIDE_LIMITS.text} defaultValue={value[l] ?? ""} className={area} />}
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------- Texts ----------

export function GuideTextsForm(props: {
  listingId: string;
  mapsUrl: string | null;
  defaultMapsUrl: string;
  directions: Localized;
  accessInstructions: Localized;
  houseRules: string;
  houseRulesTranslations: Localized;
  useOrgRecommendations: boolean;
  orgRecommendations: number;
}) {
  const [state, action, pending] = useActionState<GuideFormState, FormData>(saveGuideTextsAction.bind(null, props.listingId), {});
  const v = (k: string, fallback: string) => state.values?.[k] ?? fallback;
  const loc = (name: string, value: Localized): Localized => (state.values ? Object.fromEntries(GUEST_LOCALES.map((l) => [l, state.values![`${name}_${l}`] ?? ""])) : value);
  return (
    <form action={action} noValidate className={`${card} space-y-5`} data-testid="guide-texts-form">
      <h2 className="text-title-s font-semibold">Accès, itinéraire et règles</h2>
      <Feedback state={state} />
      <Field label="Lien de l'itinéraire (Google Maps, Waze…)" hint={`Vide : la carte s'ouvre sur les coordonnées du bien.`} error={state.fieldErrors?.mapsUrl}>
        {(p) => <input {...p} name="mapsUrl" type="url" inputMode="url" placeholder={props.defaultMapsUrl} defaultValue={v("mapsUrl", props.mapsUrl ?? "")} maxLength={GUIDE_LIMITS.mapsUrl} className={input} />}
      </Field>
      <LocalizedArea name="directions" label="Itinéraire" value={loc("directions", props.directions)} errors={state.fieldErrors} rows={3} />
      <LocalizedArea name="access" label="Instructions d'accès" value={loc("access", props.accessInstructions)} errors={state.fieldErrors} />
      <LocalizedArea
        name="rules"
        label="Règles de la maison"
        value={loc("rules", { fr: props.houseRules, ...props.houseRulesTranslations })}
        errors={state.fieldErrors}
        frenchOverride={
          <div>
            <p className="mb-1 text-micro font-medium">Règles de la maison (français)</p>
            <p className="whitespace-pre-line rounded-sm bg-surface-2 p-3 text-ink">{props.houseRules || "Aucune règle renseignée."}</p>
            <p className="mt-1 text-caption text-ink-muted">Le texte français se modifie dans la fiche du bien (« Modifier »). Une règle par ligne.</p>
          </div>
        }
      />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="useOrgRecommendations" defaultChecked={state.values ? state.values.useOrgRecommendations === "on" : props.useOrgRecommendations} className="mt-1 size-4 accent-brand" />
        <span>
          Ajouter les recommandations communes de l&apos;organisation ({props.orgRecommendations}) après celles du bien
        </span>
      </label>
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer le guide"}
      </Button>
    </form>
  );
}

// ---------- Wi-Fi ----------

export function WifiForm({ listingId, wifiName, hasPassword }: { listingId: string; wifiName: string | null; hasPassword: boolean }) {
  const [state, action, pending] = useActionState<GuideFormState, FormData>(saveWifiAction.bind(null, listingId), {});
  return (
    <form action={action} noValidate className={`${card} space-y-4`} data-testid="guide-wifi-form">
      <h2 className="text-title-s font-semibold">Wi-Fi</h2>
      <Feedback state={state} />
      <Field label="Nom du réseau" error={state.fieldErrors?.wifiName}>
        {(p) => <input {...p} name="wifiName" autoComplete="off" defaultValue={state.values?.wifiName ?? wifiName ?? ""} maxLength={GUIDE_LIMITS.wifiName} className={input} />}
      </Field>
      <Field
        label="Mot de passe du Wi-Fi"
        hint={hasPassword ? "Enregistré (chiffré). Laissez vide pour le garder." : "Chiffré dans la base ; montré au voyageur seulement pendant son séjour."}
        error={state.fieldErrors?.wifiPassword}
      >
        {(p) => <input {...p} name="wifiPassword" type="password" autoComplete="new-password" maxLength={GUIDE_LIMITS.wifiPassword} className={input} />}
      </Field>
      {hasPassword && (
        <label className="flex items-start gap-3">
          <input type="checkbox" name="clearWifiPassword" className="mt-1 size-4 accent-brand" />
          <span>Supprimer le mot de passe enregistré</span>
        </label>
      )}
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer le Wi-Fi"}
      </Button>
    </form>
  );
}

// ---------- Access codes ----------

export interface CodeRow {
  id: string;
  kind: GuideAccessCodeKind;
  label: string;
}

function CodeFields({ state, kind, label, valueLabel, valueHint }: { state: GuideFormState; kind?: string; label?: string; valueLabel: string; valueHint?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Type de code" error={state.fieldErrors?.kind}>
        {(p) => (
          <select {...p} name="kind" defaultValue={state.values?.kind ?? kind ?? "DOOR"} className={input}>
            {ACCESS_CODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCESS_CODE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Précision (facultatif)" error={state.fieldErrors?.label}>
        {(p) => <input {...p} name="label" placeholder="Porte de la terrasse" defaultValue={state.values?.label ?? label ?? ""} maxLength={GUIDE_LIMITS.codeLabel} className={input} />}
      </Field>
      <Field label={valueLabel} hint={valueHint} error={state.fieldErrors?.value}>
        {(p) => <input {...p} name="value" type="password" autoComplete="off" maxLength={GUIDE_LIMITS.codeValue} className={`${input} font-mono`} />}
      </Field>
    </div>
  );
}

function EditCode({ listingId, code, onDone }: { listingId: string; code: CodeRow; onDone: () => void }) {
  const [state, action, pending] = useActionState<GuideFormState, FormData>(async (prev, form) => {
    const r = await updateCodeAction(listingId, code.id, prev, form);
    if (!r.error) onDone();
    return r;
  }, {});
  return (
    <form action={action} noValidate className="mt-3 space-y-3 rounded-sm bg-surface-2 p-3">
      <Feedback state={state} />
      <CodeFields state={state} kind={code.kind} label={code.label} valueLabel="Nouveau code" valueHint="Vide : le code ne change pas." />
      <Button type="submit" variant="dark" size="sm" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer"}
      </Button>
    </form>
  );
}

/**
 * The home's access codes: never sent to the browser until the associé asks (« Afficher les codes », audited); then
 * shown until the page is left. Add, change (the value only if typed), delete.
 */
export function CodesManager({ listingId, codes, hasWifiPassword }: { listingId: string; codes: CodeRow[]; hasWifiPassword: boolean }) {
  const [revealed, setRevealed] = useState<RevealedSecrets | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [addState, addAction, adding] = useActionState<GuideFormState, FormData>(async (prev, form) => {
    const r = await addCodeAction(listingId, prev, form);
    if (!r.error) setRevealed(null);
    return r;
  }, {});
  const valueOf = (id: string) => revealed?.codes.find((c) => c.id === id)?.value;

  return (
    <section className={`${card} space-y-4`} aria-labelledby="codes-title" data-testid="guide-codes-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="codes-title" className="text-title-s font-semibold">
          Codes d&apos;accès
        </h2>
        {(codes.length > 0 || hasWifiPassword) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              revealed
                ? setRevealed(null)
                : start(async () => {
                    setError(null);
                    const r = await revealSecretsAction(listingId);
                    if (r.error) setError(r.error);
                    else setRevealed(r.secrets ?? null);
                  })
            }
          >
            {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            {revealed ? "Masquer" : "Afficher les codes"}
          </Button>
        )}
      </div>
      <p className="text-ink-muted">
        Chiffrés dans la base. Le voyageur les voit dans son guide de l&apos;heure d&apos;arrivée à l&apos;heure de départ ; chaque affichage ici est
        enregistré dans l&apos;historique.
      </p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {revealed && hasWifiPassword && (
        <p className="rounded-sm bg-surface-2 p-3" data-testid="revealed-wifi">
          Wi-Fi « {revealed.wifiName ?? "—"} » : <span className="font-mono font-semibold">{revealed.wifiPassword ?? "illisible"}</span>
        </p>
      )}
      {codes.length === 0 ? (
        <p className="rounded-sm bg-surface-2 p-3 text-ink-muted">Aucun code : le voyageur verra « l&apos;équipe vous accueille ».</p>
      ) : (
        <ul className="divide-y divide-line rounded-sm border border-line">
          {codes.map((c) => {
            const value = valueOf(c.id);
            return (
              <li key={c.id} className="p-3" data-testid="guide-code-row">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{ACCESS_CODE_KIND_LABEL[c.kind]}</p>
                    {c.label && <p className="text-caption text-ink-muted">{c.label}</p>}
                    <p className="font-mono text-title-s" data-testid="code-value">
                      {revealed ? (value ?? "illisible") : "••••••"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                      {editing === c.id ? "Fermer" : "Modifier"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      aria-label={`Supprimer le code ${ACCESS_CODE_KIND_LABEL[c.kind]}`}
                      onClick={() =>
                        confirm("Supprimer ce code ?") &&
                        start(async () => {
                          const r = await deleteCodeAction(listingId, c.id);
                          if (r.error) setError(r.error);
                          setRevealed(null);
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {editing === c.id && (
                  <EditCode
                    listingId={listingId}
                    code={c}
                    onDone={() => {
                      setEditing(null);
                      setRevealed(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {codes.length < GUIDE_LIMITS.codesPerListing && (
        <form action={addAction} noValidate className="space-y-3 border-t border-line pt-4" data-testid="add-code-form">
          <h3 className="font-semibold">Ajouter un code</h3>
          <Feedback state={addState} />
          <CodeFields state={addState} valueLabel="Code" />
          <Button type="submit" variant="dark" size="sm" disabled={adding}>
            {adding ? "Un instant…" : "Ajouter le code"}
          </Button>
        </form>
      )}
    </section>
  );
}

// ---------- Photos ----------

export function GuidePhotos({ listingId, photos }: { listingId: string; photos: { id: string; url: string; caption: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  return (
    <section className={`${card} space-y-4`} aria-labelledby="guide-photos-title">
      <h2 id="guide-photos-title" className="text-title-s font-semibold">
        Photos de l&apos;accès
      </h2>
      <p className="text-ink-muted">La porte, la boîte à clés, le parking : vues seulement par les voyageurs qui ont le lien du guide.</p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || "Photo de l'accès"} className="aspect-[4/3] w-full rounded-sm border border-line object-cover" />
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-caption text-ink-muted">{p.caption}</span>
                <button
                  type="button"
                  aria-label="Supprimer la photo"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteGuidePhotoAction(listingId, p.id);
                      setError(r.error ?? null);
                    })
                  }
                  className="inline-grid size-8 place-items-center rounded-full border border-line hover:bg-surface-2"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {photos.length < GUIDE_LIMITS.photosPerListing && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Légende (facultatif)">
              {(p) => <input {...p} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={GUIDE_LIMITS.photoCaption} className={input} />}
            </Field>
          </div>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2">
            <ImagePlus className="size-4" aria-hidden="true" />
            {pending ? "Envoi…" : "Ajouter une photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (!file) return;
                if (file.size > MAX_PHOTO_BYTES) return setError(`${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.`);
                const form = new FormData();
                form.set("photo", file);
                form.set("caption", caption);
                start(async () => {
                  const r = await uploadGuidePhotoAction(listingId, form);
                  setError(r.error ?? null);
                  if (!r.error) setCaption("");
                });
              }}
            />
          </label>
        </div>
      )}
    </section>
  );
}

// ---------- Recommendations ----------

export interface RecommendationRow {
  id: string;
  category: GuideRecommendationCategory;
  name: string;
  description: Localized;
  url: string | null;
}

function RecommendationFields({ state, r }: { state: GuideFormState; r?: RecommendationRow }) {
  const v = (k: string, fallback: string) => state.values?.[k] ?? fallback;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Catégorie" error={state.fieldErrors?.category}>
          {(p) => (
            <select {...p} name="category" defaultValue={v("category", r?.category ?? "RESTAURANT")} className={input}>
              {RECOMMENDATION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {RECOMMENDATION_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Nom" error={state.fieldErrors?.name}>
          {(p) => <input {...p} name="name" defaultValue={v("name", r?.name ?? "")} maxLength={GUIDE_LIMITS.recoName} className={input} />}
        </Field>
      </div>
      <Field label="Lien (facultatif)" error={state.fieldErrors?.url}>
        {(p) => <input {...p} name="url" type="url" inputMode="url" placeholder="https://" defaultValue={v("url", r?.url ?? "")} maxLength={GUIDE_LIMITS.recoUrl} className={input} />}
      </Field>
      <LocalizedArea
        name="description"
        label="Description"
        rows={2}
        value={state.values ? Object.fromEntries(GUEST_LOCALES.map((l) => [l, state.values![`description_${l}`] ?? ""])) : (r?.description ?? {})}
        errors={state.fieldErrors}
      />
    </div>
  );
}

function EditRecommendation({ r }: { r: RecommendationRow }) {
  const [state, action, pending] = useActionState<GuideFormState, FormData>(updateRecommendationAction.bind(null, r.id), {});
  return (
    <form action={action} noValidate className="mt-3 space-y-3 rounded-sm bg-surface-2 p-3">
      <Feedback state={state} />
      <RecommendationFields state={state} r={r} />
      <Button type="submit" variant="dark" size="sm" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer"}
      </Button>
    </form>
  );
}

/** A home's recommendations (listingId) or the organization's defaults (listingId null). */
export function RecommendationsManager({ listingId, items, title, intro }: { listingId: string | null; items: RecommendationRow[]; title: string; intro: string }) {
  const [state, action, pending] = useActionState<GuideFormState, FormData>(addRecommendationAction.bind(null, listingId), {});
  const [deleting, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={`${card} space-y-4`} aria-label={title} data-testid="recommendations-admin">
      <h2 className="text-title-s font-semibold">{title}</h2>
      <p className="text-ink-muted">{intro}</p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-sm border border-line">
          {items.map((r) => (
            <li key={r.id} className="p-3" data-testid="recommendation-row">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {r.name} <span className="font-normal text-ink-muted">· {RECOMMENDATION_CATEGORY_LABEL[r.category]}</span>
                  </p>
                  {r.description.fr && <p className="text-ink-muted">{r.description.fr}</p>}
                  <p className="text-caption text-ink-muted">
                    Langues : {GUEST_LOCALES.filter((l) => r.description[l]).map((l) => LOCALE_INFO[l].frenchName.toLowerCase()).join(", ") || "—"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Supprimer ${r.name}`}
                  disabled={deleting}
                  onClick={() =>
                    confirm(`Supprimer « ${r.name} » ?`) &&
                    start(async () => {
                      const res = await deleteRecommendationAction(r.id);
                      setError(res.error ?? null);
                    })
                  }
                  className="inline-grid size-9 place-items-center rounded-full border border-line hover:bg-surface-2"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <details>
                <summary className="mt-1 cursor-pointer text-caption font-semibold underline underline-offset-2">Modifier</summary>
                <EditRecommendation r={r} />
              </details>
            </li>
          ))}
        </ul>
      )}
      <form action={action} noValidate className="space-y-3 border-t border-line pt-4">
        <h3 className="font-semibold">Ajouter une recommandation</h3>
        <Feedback state={state} />
        <RecommendationFields key={state.message ?? "new"} state={state.message ? {} : state} />
        <Button type="submit" variant="dark" size="sm" disabled={pending}>
          {pending ? "Un instant…" : "Ajouter"}
        </Button>
      </form>
    </section>
  );
}

// ---------- Organization contact ----------

export function ConciergeForm({ phone, whatsapp }: { phone: string | null; whatsapp: string | null }) {
  const [state, action, pending] = useActionState<GuideFormState, FormData>(saveConciergeAction, {});
  return (
    <form action={action} noValidate className={`${card} space-y-4`}>
      <h2 className="text-title-s font-semibold">Contact de la conciergerie</h2>
      <p className="text-ink-muted">Affiché dans chaque guide (boutons « Appeler » et « WhatsApp » en bas de l&apos;écran). Vide : non affiché.</p>
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Téléphone" error={state.fieldErrors?.conciergePhone}>
          {(p) => <input {...p} name="conciergePhone" type="tel" placeholder="+212 6 12 34 56 78" defaultValue={state.values?.conciergePhone ?? phone ?? ""} className={input} />}
        </Field>
        <Field label="WhatsApp" error={state.fieldErrors?.conciergeWhatsapp}>
          {(p) => <input {...p} name="conciergeWhatsapp" type="tel" placeholder="+212 6 12 34 56 78" defaultValue={state.values?.conciergeWhatsapp ?? whatsapp ?? ""} className={input} />}
        </Field>
      </div>
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer"}
      </Button>
    </form>
  );
}

// ---------- Booking: guide link ----------

export interface GuideLinkView {
  status: "NONE" | "ACTIVE" | "REVOKED";
  link: string | null;
  whatsapp: string | null;
  createdAt: string | null;
  guestLocale: GuestLocale | null;
  eligible: boolean;
}

export function GuideLinkCard({ bookingId, view }: { bookingId: string; view: GuideLinkView }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<GuideLinkState>({});
  const [copied, setCopied] = useState(false);
  const [langState, langAction, langPending] = useActionState<GuideLinkState, FormData>(setGuestLocaleAction.bind(null, bookingId), {});
  const id = useId();
  const run = (fn: () => Promise<GuideLinkState>) => start(async () => setState(await fn()));

  return (
    <section className={`${card} space-y-4`} aria-labelledby={`${id}-t`} data-testid="guide-link-card">
      <h2 id={`${id}-t`} className="flex items-center gap-2 text-title-s font-semibold">
        <Link2 className="size-5 text-brand" aria-hidden="true" />
        Guide d&apos;accueil
      </h2>
      {!view.eligible ? (
        <p className="text-ink-muted">Pas de guide pour un blocage propriétaire ou une réservation annulée.</p>
      ) : (
        <>
          <p className="text-ink-muted">
            Lien secret du voyageur : accès, Wi-Fi, règles, recommandations. Les codes et le mot de passe du Wi-Fi n&apos;y apparaissent
            qu&apos;entre l&apos;heure d&apos;arrivée et l&apos;heure de départ.
          </p>
          <Feedback state={state} />
          {view.status === "ACTIVE" && view.link ? (
            <div className="space-y-3">
              <label htmlFor={`${id}-l`} className="block text-micro font-medium">
                Lien du guide
              </label>
              <input
                id={`${id}-l`}
                readOnly
                value={view.link}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="guide-link"
                className="h-11 w-full rounded-sm border border-ink-faint bg-white px-3 font-mono text-caption outline-none focus:border-ink"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(view.link!);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-sm bg-ink px-4 font-semibold text-white hover:bg-black"
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {copied ? "Lien copié" : "Copier le lien"}
                </button>
                {view.whatsapp && (
                  <a href={view.whatsapp} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2">
                    <MessageCircle className="size-4" aria-hidden="true" />
                    Partager sur WhatsApp
                  </a>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => confirm("Créer un nouveau lien ? L'ancien ne fonctionnera plus.") && run(() => issueGuideLinkAction(bookingId))}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Régénérer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  className="border-error text-error hover:bg-[#fdecea]"
                  onClick={() => confirm("Révoquer le lien ? Le voyageur n'aura plus accès au guide.") && run(() => revokeGuideLinkAction(bookingId))}
                >
                  Révoquer
                </Button>
              </div>
              {view.createdAt && <p className="text-caption text-ink-muted">Créé le {view.createdAt}.</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {view.status === "REVOKED" && <p className="text-ink-muted">Le lien précédent a été révoqué.</p>}
              {view.status === "ACTIVE" && <p className="text-error">Le lien enregistré est illisible (clé de chiffrement changée ?) : créez-en un nouveau.</p>}
              <Button type="button" variant="dark" disabled={pending} onClick={() => run(() => issueGuideLinkAction(bookingId))}>
                {pending ? "Un instant…" : "Créer le lien du guide"}
              </Button>
            </div>
          )}
          <form action={langAction} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <div>
              <label htmlFor={`${id}-lang`} className="mb-1 block text-micro font-medium">
                Langue du voyageur
              </label>
              <select id={`${id}-lang`} name="guestLocale" defaultValue={view.guestLocale ?? ""} className="h-11 rounded-sm border border-ink-faint bg-white px-3">
                <option value="">Celle de son navigateur</option>
                {GUEST_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_INFO[l].frenchName}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={langPending}>
              Enregistrer
            </Button>
            <div className="w-full">
              <Feedback state={langState} />
            </div>
          </form>
        </>
      )}
    </section>
  );
}

// ---------- Task: codes for the agent ----------

export function TaskCodes({ taskId }: { taskId: string }) {
  const [pending, start] = useTransition();
  const [secrets, setSecrets] = useState<RevealedSecrets | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={`${card} space-y-3`} aria-labelledby="task-codes-title" data-testid="task-codes">
      <h2 id="task-codes-title" className="text-title-s font-semibold">
        Codes d&apos;accès du logement
      </h2>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {secrets ? (
        <div className="space-y-2">
          {secrets.codes.length === 0 && !secrets.wifiPassword && <p className="text-ink-muted">Aucun code enregistré pour ce logement.</p>}
          <ul className="space-y-1">
            {secrets.codes.map((c) => (
              <li key={c.id}>
                {ACCESS_CODE_KIND_LABEL[c.kind]}
                {c.label && ` (${c.label})`} : <span className="font-mono font-semibold">{c.value ?? "illisible"}</span>
              </li>
            ))}
            {secrets.wifiPassword && (
              <li>
                Wi-Fi « {secrets.wifiName ?? "—"} » : <span className="font-mono font-semibold">{secrets.wifiPassword}</span>
              </li>
            )}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={() => setSecrets(null)}>
            <EyeOff className="size-4" aria-hidden="true" />
            Masquer
          </Button>
        </div>
      ) : (
        <>
          <p className="text-ink-muted">Visibles pour les tâches qui vous sont confiées aujourd&apos;hui ou demain. Chaque affichage est enregistré.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await revealTaskCodesAction(taskId);
                setError(r.error ?? null);
                setSecrets(r.secrets ?? null);
              })
            }
          >
            <Eye className="size-4" aria-hidden="true" />
            Afficher les codes
          </Button>
        </>
      )}
    </section>
  );
}
