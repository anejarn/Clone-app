import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { EXTENSION_TYPE } from "./images";
import { assertStorageKey, type FileStorage, type StoredFile } from "./types";

/**
 * Files on the server's disk, under UPLOAD_DIR (default ./uploads, git-ignored). Fine for one server; back the
 * directory up with the database. Served by app/media/[...key]/route.ts, which checks who may see each file.
 */
export class LocalStorage implements FileStorage {
  readonly root: string;

  // turbopackIgnore: runtime paths, not files of the app; keeps the build from tracing the whole project.
  constructor(root = join(/* turbopackIgnore: true */ process.cwd(), "uploads")) {
    this.root = resolve(/* turbopackIgnore: true */ root);
  }

  private path(key: string): string {
    assertStorageKey(key);
    const p = resolve(/* turbopackIgnore: true */ this.root, key);
    // Belt and braces: the key check already rules out "..".
    if (!p.startsWith(this.root + sep)) throw new Error(`storage key escapes the root: ${key}`);
    return p;
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    void _contentType;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    // "wx": never overwrite; keys are random, a clash is a bug.
    await writeFile(p, bytes, { flag: "wx" });
  }

  async get(key: string): Promise<StoredFile | null> {
    const p = this.path(key);
    try {
      const bytes = await readFile(p);
      const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
      return { bytes: new Uint8Array(bytes), contentType: EXTENSION_TYPE[ext] ?? "application/octet-stream" };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  url(key: string): string {
    assertStorageKey(key);
    return `/media/${key}`;
  }
}
