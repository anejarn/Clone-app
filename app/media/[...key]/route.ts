import { STAFF_ROLES } from "@/lib/admin/sections";
import { photoAccess } from "@/lib/server/admin/listings";
import { checkAccess } from "@/lib/server/authz";
import { taskPhotoAccess } from "@/lib/server/operations/tasks";
import { errorResponse, handle } from "@/lib/server/http";
import { fileStorage } from "@/lib/storage";
import { STORAGE_KEY_RE } from "@/lib/storage/types";

/**
 * GET /media/<key> → an uploaded file of the local store (lib/storage/local.ts). Only keys recorded on a photo are
 * served: a photo of a published listing to anyone (it is on the public site), a draft's photo only to the staff
 * (ADMIN, AGENT with double authentification) of the listing's organization, a field task's photo (tasks/…) only to
 * the staff of the task's organization, never cached. Everything else is 404, so the answer never tells whether a
 * draft or a task exists.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/media/[...key]">) => {
  const key = (await ctx.params).key.join("/");
  const missing = () => errorResponse(404, "NOT_FOUND", "Fichier introuvable.");
  if (!STORAGE_KEY_RE.test(key)) return missing();
  let access: { organizationId: string; published: boolean } | null = null;
  if (key.startsWith("listings/")) access = await photoAccess(key);
  else if (key.startsWith("tasks/")) {
    const task = await taskPhotoAccess(key);
    access = task && { organizationId: task.organizationId, published: false };
  }
  if (!access) return missing();
  if (!access.published) {
    const staff = await checkAccess(STAFF_ROLES, { headers: request.headers });
    if (!staff.ok || staff.organizationId !== access.organizationId) return missing();
  }
  const file = await fileStorage().get(key);
  if (!file) return missing();
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      // A day for public photos (keys are never reused; a listing taken back to draft drops out within a day);
      // a draft's or a task's photo is never cached by the browser or a CDN.
      "Cache-Control": access.published ? "public, max-age=86400" : "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
