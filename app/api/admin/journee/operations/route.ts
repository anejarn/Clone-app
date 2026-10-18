import { fieldOpSchema } from "@/lib/operations/field-ops";
import { requireAdminApi } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, handle, parseOrThrow, readBodyBytes } from "@/lib/server/http";
import { applyFieldOp } from "@/lib/server/operations/field-sync";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/** A photo (5 MB at most) plus the multipart envelope and the operation. */
const MAX_BODY_BYTES = MAX_PHOTO_BYTES + 256 * 1024;

/**
 * POST /api/admin/journee/operations: one change of « Ma journée » (multipart: `op` = the operation as JSON,
 * `photo` = the file for a photo operation). 200 { result } once decided — applied or refused (the server wins on
 * conflicts) — and the same answer again for the same opId; 400 for an operation that can't be read; 401/403 as every
 * back-office route (the phone keeps it and retries after sign-in). Rules: lib/server/operations/field-sync.ts.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const access = await requireAdminApi(request, "/admin/ma-journee");
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) throw new AppError(400, "INVALID_INPUT", "Envoyez l'opération en multipart/form-data.");
  const bytes = await readBodyBytes(request, MAX_BODY_BYTES);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": type } }).formData();
  } catch {
    throw new AppError(400, "INVALID_INPUT", "Corps de requête illisible.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("op") ?? ""));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Opération JSON invalide.");
  }
  const op = parseOrThrow(fieldOpSchema, raw);
  const file = form.get("photo");
  let photo: Uint8Array | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.`);
    photo = new Uint8Array(await file.arrayBuffer());
  }
  const result = await applyFieldOp(access, op, photo);
  return Response.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
});
