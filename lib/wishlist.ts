"use client";

import { useSyncExternalStore } from "react";

/**
 * Saved listings. Signed out: kept in localStorage. Signed in: the account is the source of truth
 * (/api/wishlist), and anything saved while signed out is merged in once at sign-in.
 * WishlistSync (in the root layout) switches between the two.
 */
const KEY = "nidou:wishlist";

type Mode = "pending" | "local" | "account";
interface State {
  ids: string[];
  mode: Mode;
}

const listeners = new Set<() => void>();
const SERVER_STATE: State = { ids: [], mode: "pending" };
let state: State | null = null;

function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLocal(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(KEY, JSON.stringify(ids));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode): in-memory only.
  }
}

function get(): State {
  return (state ??= { ids: readLocal(), mode: "pending" });
}

function set(next: State) {
  state = next;
  if (next.mode !== "account") writeLocal(next.ids);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && get().mode !== "account") set({ ...get(), ids: readLocal() });
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Signed in: merge local favourites into the account, then follow the account. */
export async function attachAccount() {
  const local = get().mode === "account" ? [] : readLocal();
  const res = await fetch("/api/wishlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: local }),
  });
  if (!res.ok) return set({ ids: local, mode: "local" });
  const { ids } = (await res.json()) as { ids: string[] };
  writeLocal([]);
  set({ ids, mode: "account" });
}

/** Signed out: back to this browser's list (emptied at sign-in, so an account's favourites don't linger). */
export function detachAccount() {
  set({ ids: readLocal(), mode: "local" });
}

export function useWishlist() {
  const s = useSyncExternalStore(subscribe, get, () => SERVER_STATE);
  const has = (id: string) => s.ids.includes(id);

  async function toggle(id: string) {
    const saved = has(id);
    const before = get();
    // Optimistic: flip now, roll back if the server refuses.
    set({ ...before, ids: saved ? before.ids.filter((x) => x !== id) : [id, ...before.ids] });
    if (before.mode !== "account") return;
    const res = await fetch(`/api/wishlist/${encodeURIComponent(id)}`, { method: saved ? "DELETE" : "PUT" }).catch(() => null);
    if (!res?.ok) set(before);
  }

  return { ids: s.ids, ready: s.mode !== "pending", toggle, has };
}
