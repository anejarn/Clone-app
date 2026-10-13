import { z } from "zod";

/** Shared zod pieces for request input. */

/**
 * Listing and booking ids ("1009", cuids). Anything else cannot exist, so it is answered without a query
 * (a NUL byte, for one, would make Postgres fail with a 500).
 */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const idSchema = z.string().regex(ID_RE, "identifiant invalide");

/** C0 control characters and DEL, except tab and line breaks; Postgres refuses NUL in text columns. */
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed free text of at most `max` characters, without control characters. */
export function text(max: number) {
  return z.string().trim().max(max).refine((s) => !CONTROL_RE.test(s), "caractères non autorisés");
}
