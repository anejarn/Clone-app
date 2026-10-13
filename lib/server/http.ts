import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { getCurrentUser, type SessionUser } from "./auth";
import { AppError } from "./errors";

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

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
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

export function searchParamsObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}
