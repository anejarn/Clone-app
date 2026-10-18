/**
 * A very small promise wrapper over IndexedDB for « Ma journée » (no dependency): one database, three stores.
 * - "kv": the day's snapshot as last received from the server ({ key: "day", … });
 * - "ops": the changes waiting to be sent, in order (auto-incremented `seq`), photos as Blobs;
 * - "conflicts": the changes the server refused, with its message, until the agent dismisses them.
 * Everything is the signed-in agent's own data; lib/offline/clear.ts deletes the whole database at sign-out.
 */

export const OFFLINE_DB_NAME = "sigma-journee";
const VERSION = 1;
export type StoreName = "kv" | "ops" | "conflicts";

let opening: Promise<IDBDatabase> | null = null;
/** Set at sign-out: this page may not create the database again (a sync still running would). */
let deleted = false;

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function openOfflineDb(): Promise<IDBDatabase> {
  if (deleted) return Promise.reject(new Error("offline data cleared (signed out)"));
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
      if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "opId" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab deletes the database (sign-out): let it.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openOfflineDb();
  const t = db.transaction(store, mode);
  const result = done(fn(t.objectStore(store)));
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

export const idb = {
  get: <T>(store: StoreName, key: IDBValidKey) => tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  all: <T>(store: StoreName) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  put: (store: StoreName, value: unknown) => tx<IDBValidKey>(store, "readwrite", (s) => s.put(value)),
  delete: (store: StoreName, key: IDBValidKey) => tx<undefined>(store, "readwrite", (s) => s.delete(key)),
  clear: (store: StoreName) => tx<undefined>(store, "readwrite", (s) => s.clear()),
};

/** A new « Ma journée » page (after signing in again in the same tab) may use the database again. */
export function allowOfflineDb(): void {
  deleted = false;
}

/** Deletes the database (sign-out). Resolves even if another tab keeps it open a moment (it closes on versionchange). */
export function deleteOfflineDb(): Promise<void> {
  deleted = true;
  void opening?.then((db) => db.close()).catch(() => {});
  opening = null;
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve();
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
