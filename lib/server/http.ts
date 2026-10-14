import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { getCurrentUser, type SessionUser } from "./auth";
import { AppError } from "./errors";
import { ID_RE } from "./schemas";

export { ID_RE, idSchema, text } from "./schemas";

/** JSON error body: { error: { code, message } }. */
export function errorResponse(status: number, code: string, message: string, extra?: object) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

/**
 * Wraps a Route Handler: AppError → its status, invalid input → 400, anything else → 500 without details.
 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      // Next.js signals (prerender bail-out, redirect, notFound) are thrown errors: let them through.
      unstable_rethrow(e);
      if (e instanceof AppError) return errorResponse(e.status, e.code, e.message);
      if (e instanceof Response) return e;
      console.error(e);
      return errorResponse(500, "INTERNAL", "Une erreur est survenue. Réessayez plus tard.");
    }
  };
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getCurrentUser(request.headers);
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Connectez-vous pour continuer.");
  return user;
}

/**
 * CSRF defence in depth for cookie-authenticated writes: browsers always send Origin on cross-site
 * POST/PUT/DELETE, so a mismatching Origin is rejected. (Session cookies are also SameSite=Lax.)
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AppError(403, "BAD_ORIGIN", "Origine non autorisée.");
}

/** Default cap on a request body. The largest legitimate one, a wishlist merge of 500 ids, stays well below. */
export const MAX_JSON_BYTES = 64 * 1024;

const tooLarge = () => new AppError(413, "PAYLOAD_TOO_LARGE", "Requête trop volumineuse.");

/**
 * Reads the body as a stream and stops at `maxBytes`, so an oversized body is refused before it is buffered
 * or parsed (zod's max lengths only run on what has already been read). A declared Content-Length over the
 * cap is refused without reading at all.
 */
export async function readBodyBytes(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) throw tooLarge();
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes;
}

export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
  { maxBytes = MAX_JSON_BYTES }: { maxBytes?: number } = {},
): Promise<z.infer<T>> {
  const text = new TextDecoder().decode(await readBodyBytes(request, maxBytes));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "Corps de requête JSON invalide.");
  }
  return parseOrThrow(schema, body);
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(400, "INVALID_INPUT", `${first.path.join(".") || "requête"} : ${first.message}`);
  }
  return parsed.data;
}

/** Returns `id` when it is well-formed, otherwise answers 404 as for an unknown id, without a query. */
export function wellFormedId(id: string, message = "Logement introuvable."): string {
  if (!ID_RE.test(id)) throw new AppError(404, "NOT_FOUND", message);
  return id;
}

export function searchParamsObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}
