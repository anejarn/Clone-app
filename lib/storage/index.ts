import "server-only";
import { LocalStorage } from "./local";
import type { FileStorage } from "./types";

export type { FileStorage, StoredFile } from "./types";

/**
 * The file store for uploads (listing photos today; documents later). Local disk for now: the choice of a cloud
 * provider (S3-compatible bucket, region, data transfer under loi 09-08) is the associés' to make. A provider is
 * plugged in by writing another FileStorage and choosing it here, e.g. from an environment variable.
 */
let storage: FileStorage | undefined;

export function fileStorage(): FileStorage {
  storage ??= new LocalStorage(process.env.UPLOAD_DIR);
  return storage;
}

/** Tests swap the store (e.g. for one under a temporary directory). */
export function setFileStorage(s: FileStorage | undefined) {
  storage = s;
}
