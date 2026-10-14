/**
 * Listing and booking ids ("1009", cuids). Anything else cannot exist, so the server answers it without a
 * query (a NUL byte, for one, would make Postgres fail with a 500) and the browser never sends it.
 */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isWellFormedId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);
