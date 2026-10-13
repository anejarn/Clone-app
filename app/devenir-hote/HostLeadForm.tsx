"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { errorField, HOST_LEAD_LIMITS, HOST_LEAD_TYPES, validateHostLead, type HostLeadField } from "@/lib/host-lead";

type Errors = Partial<Record<HostLeadField, string>>;

const control =
  "w-full rounded-sm border border-ink-faint bg-white px-4 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error aria-[invalid=true]:ring-error";

/**
 * Owner lead form: validates in the browser (French messages under each field, focus on the first one to fix),
 * posts to /api/host-leads, and maps a field error from the server back onto its field.
 */
export function HostLeadForm({ places }: { places: { slug: string; name: string; inseeCode: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inseeBySlug = Object.fromEntries(places.map((p) => [p.slug, p.inseeCode]));

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  function focusFirst(errs: Errors) {
    const first = Object.keys(errs)[0];
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "");
    const result = validateHostLead(
      {
        name: text("name"),
        email: text("email"),
        phone: text("phone"),
        placeSlug: text("placeSlug"),
        propertyType: text("propertyType"),
        beds: text("beds"),
        openWinterWeeks: text("openWinterWeeks"),
        registrationNumber: text("registrationNumber"),
        message: text("message"),
        consent: f.get("consent") === "on",
      },
      inseeBySlug,
    );
    if (result.errors) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/host-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result.payload) });
      if (res.ok) {
        setDone(true);
        return;
      }
      const message = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
      const field = message ? errorField(message) : null;
      if (field && message) {
        const errs = { [field]: message.replace(/^\w+ : /, "") };
        setErrors(errs);
        focusFirst(errs);
      } else {
        setFormError(message ?? "Une erreur est survenue. Réessayez.");
      }
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-lg border border-line p-8 text-center">
        <CircleCheck aria-hidden className="mx-auto mb-3 size-10 text-success" strokeWidth={1.5} />
        <h3 ref={doneRef} tabIndex={-1} className="text-title font-semibold outline-none">
          Merci, votre demande est envoyée
        </h3>
        <p className="mt-2 text-body-l text-ink-muted">Nous revenons vers vous pour parler de votre logement.</p>
      </div>
    );
  }

  const field = (name: HostLeadField) => ({
    name,
    id: `lead-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": [errors[name] && `lead-${name}-error`, HINTS[name] && `lead-${name}-hint`].filter(Boolean).join(" ") || undefined,
  });

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} aria-labelledby="contact-title" className="grid gap-5 md:grid-cols-2">
      <Field name="name" label="Nom et prénom" error={errors.name}>
        <input {...field("name")} required autoComplete="name" maxLength={HOST_LEAD_LIMITS.name} className={cn(control, "h-12")} />
      </Field>
      <Field name="email" label="Adresse e-mail" error={errors.email}>
        <input {...field("email")} type="email" required autoComplete="email" maxLength={HOST_LEAD_LIMITS.email} className={cn(control, "h-12")} />
      </Field>
      <Field name="phone" label="Téléphone (facultatif)" error={errors.phone}>
        <input {...field("phone")} type="tel" autoComplete="tel" maxLength={HOST_LEAD_LIMITS.phone} className={cn(control, "h-12")} />
      </Field>
      <Field name="placeSlug" label="Station" error={errors.placeSlug}>
        <select {...field("placeSlug")} required defaultValue="" className={cn(control, "h-12")}>
          <option value="" disabled>
            Choisissez une station
          </option>
          {places.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field name="propertyType" label="Type de logement" error={errors.propertyType}>
        <select {...field("propertyType")} required defaultValue="" className={cn(control, "h-12")}>
          <option value="" disabled>
            Choisissez un type
          </option>
          {HOST_LEAD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field name="beds" label="Nombre de lits" error={errors.beds}>
        <input {...field("beds")} type="number" inputMode="numeric" required min={HOST_LEAD_LIMITS.beds[0]} max={HOST_LEAD_LIMITS.beds[1]} className={cn(control, "h-12")} />
      </Field>
      <Field name="openWinterWeeks" label="Semaines que vous pouvez ouvrir cet hiver" error={errors.openWinterWeeks}>
        <input
          {...field("openWinterWeeks")}
          type="number"
          inputMode="numeric"
          required
          min={HOST_LEAD_LIMITS.openWinterWeeks[0]}
          max={HOST_LEAD_LIMITS.openWinterWeeks[1]}
          className={cn(control, "h-12")}
        />
      </Field>
      <Field name="registrationNumber" label="Numéro d'enregistrement (facultatif)" error={errors.registrationNumber}>
        <input {...field("registrationNumber")} autoComplete="off" spellCheck={false} maxLength={40} placeholder="05096004217KX" className={cn(control, "h-12 uppercase placeholder:normal-case")} />
      </Field>
      <div className="md:col-span-2">
        <Field name="message" label="Message (facultatif)" error={errors.message}>
          <textarea {...field("message")} rows={4} maxLength={HOST_LEAD_LIMITS.message} className={cn(control, "py-3")} />
        </Field>
      </div>
      <div className="md:col-span-2">
        <div className="flex items-start gap-3">
          <input
            {...field("consent")}
            type="checkbox"
            required
            className="mt-0.5 size-5 shrink-0 accent-ink"
          />
          <label htmlFor="lead-consent">
            J&apos;accepte que Nidou utilise ces informations pour me recontacter au sujet de mon logement.
          </label>
        </div>
        {errors.consent && (
          <p id="lead-consent-error" className="mt-1 pl-8 text-error">
            {errors.consent}
          </p>
        )}
      </div>
      <div className="md:col-span-2">
        {formError && (
          <p role="alert" className="mb-3 text-error">
            {formError}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="max-md:w-full">
          {busy ? "Envoi…" : "Envoyer ma demande"}
        </Button>
      </div>
    </form>
  );
}

const HINTS: Partial<Record<HostLeadField, string>> = {
  openWinterWeeks: "Entre 1 et 26 semaines.",
  registrationNumber:
    "13 caractères\u00a0: le code INSEE de la commune (05096 pour Orcières, 05098 pour Les Orres), 6 chiffres puis 2 lettres. Par exemple 05096004217KX.",
};

function Field({ name, label, error, children }: { name: HostLeadField; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={`lead-${name}`} className="mb-1 block font-medium">
        {label}
      </label>
      {children}
      {HINTS[name] && (
        <p id={`lead-${name}-hint`} className="mt-1 text-micro text-ink-muted">
          {HINTS[name]}
        </p>
      )}
      {error && (
        <p id={`lead-${name}-error`} className="mt-1 text-error">
          {error}
        </p>
      )}
    </div>
  );
}
