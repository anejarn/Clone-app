import "server-only";
import pg from "pg";
import type { Locker } from "@/lib/jobs/scheduler";

/**
 * Postgres advisory locks for the background jobs (Lot 7): pg_try_advisory_lock on a dedicated connection, held for
 * the whole job (an iCal read can take 15 s) and released on the same connection. Two workers, or the worker and
 * « Synchroniser maintenant », never run the same job: the second one gets null and skips it. A worker that dies
 * closes its connection, which releases its locks. Keys are text, hashed by Postgres (hashtextextended).
 */

let pool: pg.Pool | undefined;

function lockPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set (see .env.example)");
    pool = new pg.Pool({ connectionString, max: 8, idleTimeoutMillis: 30_000 });
    pool.on("error", (e) => console.error(`advisory lock connection: ${e.message}`));
  }
  return pool;
}

export class PgLocker implements Locker {
  constructor(private readonly getPool: () => pg.Pool = lockPool) {}

  async tryLock(key: string): Promise<(() => Promise<void>) | null> {
    const client = await this.getPool().connect();
    let ok = false;
    try {
      const r = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [`sigma:${key}`]);
      ok = r.rows[0]?.locked === true;
    } finally {
      if (!ok) client.release();
    }
    if (!ok) return null;
    return async () => {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`sigma:${key}`]);
        client.release();
      } catch (e) {
        // Drop the connection: closing it releases the lock.
        client.release(e as Error);
      }
    };
  }
}

let locker: Locker = new PgLocker();

export function jobLocker(): Locker {
  return locker;
}

/** Tests replace the locker; undefined puts the Postgres one back. */
export function setJobLocker(l: Locker | undefined) {
  locker = l ?? new PgLocker();
}

/** Closes the lock connections (worker shutdown, end of tests). */
export async function closeLockPool() {
  const p = pool;
  pool = undefined;
  await p?.end();
}
