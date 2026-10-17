"use client";

import { Minus, Plus } from "lucide-react";
import { MAX_GUESTS, type GuestCounts } from "@/lib/search/params";

const ROWS: { key: keyof GuestCounts; label: string; hint: string; max: number }[] = [
  { key: "adults", label: "Adultes", hint: "18 ans et plus", max: 16 },
  { key: "children", label: "Enfants", hint: "De 2 à 17 ans", max: 15 },
  { key: "infants", label: "Bébés", hint: "Moins de 2 ans", max: 5 },
  { key: "pets", label: "Animaux domestiques", hint: "Seuls les logements qui les acceptent", max: 5 },
];

/** Applies the stepper rules: guests (adults + children) ≤ MAX_GUESTS, and anyone else implies an adult. */
export function stepGuests(g: GuestCounts, key: keyof GuestCounts, delta: 1 | -1): GuestCounts {
  const next = { ...g, [key]: Math.max(0, g[key] + delta) };
  if (next.adults + next.children > MAX_GUESTS) return g;
  if (key !== "adults" && delta > 0 && next.adults === 0) next.adults = 1;
  return next;
}

export function minFor(g: GuestCounts, key: keyof GuestCounts): number {
  return key === "adults" && g.children + g.infants + g.pets > 0 ? 1 : 0;
}

export function GuestsPicker({ value, onChange }: { value: GuestCounts; onChange: (g: GuestCounts) => void }) {
  // A full party disables "+" for adults and children instead of letting it ignore clicks (diff search-39).
  const full = value.adults + value.children >= MAX_GUESTS;
  return (
    <div className="divide-y divide-line">
      {ROWS.map(({ key, label, hint, max }) => {
        const n = value[key];
        const atMax = n >= max || ((key === "adults" || key === "children") && full);
        return (
          <div key={key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
            <div>
              <p className="text-body-l font-medium">{label}</p>
              <p className="text-ink-muted">{hint}</p>
            </div>
            <div className="flex items-center gap-4">
              <Stepper label={`Diminuer ${label.toLowerCase()}`} disabled={n <= minFor(value, key)} onClick={() => onChange(stepGuests(value, key, -1))}>
                <Minus className="size-3.5" strokeWidth={2.5} />
              </Stepper>
              <span className="w-4 text-center text-body-l tabular-nums" aria-live="polite">
                {n}
              </span>
              <Stepper label={`Augmenter ${label.toLowerCase()}`} disabled={atMax} onClick={() => onChange(stepGuests(value, key, 1))}>
                <Plus className="size-3.5" strokeWidth={2.5} />
              </Stepper>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stepper({ label, children, ...props }: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-8 place-items-center rounded-full border border-ink-faint text-ink-muted hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:border-line-soft disabled:text-line"
      {...props}
    >
      {children}
    </button>
  );
}
