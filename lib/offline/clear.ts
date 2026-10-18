import { deleteOfflineDb, idb, OFFLINE_DB_NAME } from "./idb";

/**
 * Sign-out on this device: removes everything « Ma journée » keeps offline — its IndexedDB database (the day's tasks,
 * queued changes and photos), its caches (the page and the app's scripts) and its service worker — so the next person
 * on this phone or computer finds nothing of it. Called by every sign-out button. Never throws.
 */
export const OFFLINE_CACHE_PREFIX = "sigma-journee-";
export const MY_DAY_SCOPE = "/admin/ma-journee";

export async function clearOfflineData(): Promise<void> {
  try {
    // A worker still in charge of this page would keep caching until the page goes: tell it to stop now.
    navigator.serviceWorker?.controller?.postMessage({ type: "forget" });
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    for (const r of regs) r.active?.postMessage({ type: "forget" });
    await Promise.all(regs.filter((r) => new URL(r.scope).pathname.startsWith(MY_DAY_SCOPE)).map((r) => r.unregister()));
  } catch {
    // No service worker support, or none registered.
  }
  try {
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) if (name.startsWith(OFFLINE_CACHE_PREFIX)) await caches.delete(name);
    }
  } catch {
    // Cache storage unavailable (private mode…).
  }
  await deleteOfflineDb().catch(() => {});
}

/** How many changes of « Ma journée » are still waiting to be sent on this device (0 when there is no database). */
export async function unsentChanges(): Promise<number> {
  try {
    if (typeof indexedDB === "undefined") return 0;
    // Don't create the database just to count (when the browser can list them).
    if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some((d) => d.name === OFFLINE_DB_NAME)) return 0;
    return (await idb.all("ops")).length;
  } catch {
    return 0;
  }
}

/** Confirms a sign-out that would lose unsent changes, then clears the offline data. False = the person stayed. */
export async function prepareSignOut(): Promise<boolean> {
  const unsent = await unsentChanges();
  if (unsent > 0 && !window.confirm(`${unsent} changement${unsent > 1 ? "s" : ""} de « Ma journée » n'${unsent > 1 ? "ont" : "a"} pas encore été envoyé${unsent > 1 ? "s" : ""} et ser${unsent > 1 ? "ont" : "a"} perdu${unsent > 1 ? "s" : ""}. Se déconnecter quand même ?`)) {
    return false;
  }
  await clearOfflineData();
  return true;
}
