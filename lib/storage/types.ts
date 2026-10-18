/**
 * Where uploaded files live. Keys are opaque, slash-separated, made of [A-Za-z0-9_.-] segments, chosen by the
 * caller (e.g. "listings/<organizationId>/<listingId>/<random>.jpg"); a store never interprets them beyond that.
 * An S3-compatible store maps a key to an object name; the local store to a file under its root.
 */
export interface StoredFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** null when there is no such file. */
  get(key: string): Promise<StoredFile | null>;
  /** Idempotent: deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
  /** The URL the app serves the file at (the local store: /media/<key>, through app/media/[...key]/route.ts). */
  url(key: string): string;
}

/** A key the stores accept: no empty, "." or ".." segment, no backslash, nothing outside the safe characters. */
export const STORAGE_KEY_RE = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}\/){0,7}[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;

export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_RE.test(key) || key.split("/").some((s) => s === "." || s === ".." || s.includes(".."))) {
    throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
  }
}
