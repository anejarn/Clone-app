"use client";

import { Minus, Plus } from "lucide-react";
import type { GuestCounts } from "@/lib/search/params";

const ROWS: { key: keyof GuestCounts; label: string; hint: string; max: number }[] = [
  // Adults are 18+: the taxe de séjour is charged per adult and minors are exempt (lib/tourist-tax.ts).
  { key: "adults", label: "Adultes", hint: "18 ans et plus", max: 16 },
  { key: "children", label: "Enfants", hint: "De 2 à 17 ans", max: 15 },
  { key: "infants", label: "Bébés", hint: "Moins de 2 ans", max: 5 },
  { key: "pets", label: "Animaux domestiques", hint: "Vous voyagez avec un animal d'assistance ?", max: 5 },
];

/** Search-wide cap on adults + children; a listing's booking card passes its own maxGuests. */
export const MAX_GUESTS = 16;

/** Applies the stepper rules: guests (adults + children) ≤ maxGuests, and anyone else implies an adult. */
export function stepGuests(g: GuestCounts, key: keyof GuestCounts, delta: 1 | -1, maxGuests = MAX_GUESTS): GuestCounts {
  const next = { ...g, [key]: Math.max(0, g[key] + delta) };
  if (delta > 0 && next.adults + next.children > maxGuests) return g;
  if (key !== "adults" && delta > 0 && next.adults === 0) next.adults = 1;
  return next;
}

export function minFor(g: GuestCounts, key: keyof GuestCounts, minAdults = 0): number {
  if (key !== "adults") return 0;
  return Math.max(minAdults, g.children + g.infants + g.pets > 0 ? 1 : 0);
}

/**
 * Steppers for adults, children, infants and pets. Defaults suit the search bar; a listing passes its
 * capacity (`maxGuests`), whether pets are welcome, and `minAdults` 1 (a booking needs an adult).
 */
export function GuestsPicker({
  value,
  onChange,
  maxGuests = MAX_GUESTS,
  petsAllowed = true,
  minAdults = 0,
}: {
  value: GuestCounts;
  onChange: (g: GuestCounts) => void;
  maxGuests?: number;
  petsAllowed?: boolean;
  minAdults?: number;
}) {
  const full = value.adults + value.children >= maxGuests;
  return (
    <div className="divide-y divide-line">
      {ROWS.map(({ key, label, hint: defaultHint, max: rowMax }) => {
        const n = value[key];
        const max = key === "pets" && !petsAllowed ? 0 : rowMax;
        const hint = key === "pets" && !petsAllowed ? "Ce logement n'accepte pas les animaux" : defaultHint;
        const atMax = n >= max || ((key === "adults" || key === "children") && full);
        return (
          <div key={key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
            <div>
              <p className="text-body-l font-medium">{label}</p>
              <p className="text-ink-muted">{hint}</p>
            </div>
            <div className="flex items-center gap-4">
              <Stepper label={`Diminuer ${label.toLowerCase()}`} disabled={n <= minFor(value, key, minAdults)} onClick={() => onChange(stepGuests(value, key, -1, maxGuests))}>
                <Minus className="size-3.5" strokeWidth={2.5} />
              </Stepper>
              <span className="w-4 text-center text-body-l tabular-nums" aria-live="polite">
                {n}
              </span>
              <Stepper label={`Augmenter ${label.toLowerCase()}`} disabled={atMax} onClick={() => onChange(stepGuests(value, key, 1, maxGuests))}>
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
