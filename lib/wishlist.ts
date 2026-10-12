"use client";

import { useSyncExternalStore } from "react";

/** Per-browser saved listings until accounts land (P4). */
const KEY = "nidou:wishlist";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}

function write(ids: string[]) {
  cache = ids;
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode): keep the in-memory state only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: string[] = [];

export function useWishlist() {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = (id: string) => write(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return { ids, toggle, has: (id: string) => ids.includes(id) };
}
