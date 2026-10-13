"use client";

import { useEffect, useState } from "react";
import type { Place } from "@/lib/types";

const cache = new Map<string, Place[]>();

/** Debounced /api/autosuggest lookup; only fetches while `enabled` (the destination panel is open). */
export function useSuggestions(query: string, enabled: boolean) {
  const key = query.trim().toLowerCase();
  const [state, setState] = useState<{ key: string; places: Place[] } | null>(null);

  useEffect(() => {
    if (!enabled || cache.has(key)) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autosuggest?q=${encodeURIComponent(key)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const { places } = (await res.json()) as { places: Place[] };
        cache.set(key, places);
        setState({ key, places });
      } catch {
        // Aborted or offline: keep the previous suggestions.
      }
    }, key ? 120 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, enabled]);

  const places = cache.get(key) ?? (state?.key === key ? state.places : undefined);
  return { places: places ?? [], loading: enabled && places === undefined, forQuery: key };
}
