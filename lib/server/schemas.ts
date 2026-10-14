import { z } from "zod";
import { ID_RE } from "@/lib/ids";

/** Shared zod pieces for request input. */

export { ID_RE };
export const idSchema = z.string().regex(ID_RE, "identifiant invalide");

/** C0 control characters and DEL, except tab and line breaks; Postgres refuses NUL in text columns. */
export const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed free text of at most `max` characters, without control characters. */
export function text(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((s) => !CONTROL_RE.test(s), "caractères non autorisés");
}
