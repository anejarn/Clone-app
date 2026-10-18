"use server";

import { refresh, updateTag } from "next/cache";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { SYNC_PATH } from "@/lib/admin/sections";
import { TAGS } from "@/lib/data/repo";
import { requireAdminAction } from "@/lib/server/authz";
import { resolveConflict } from "@/lib/server/channels/conflicts";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";
import type { ChannelFormState } from "../biens/channel-actions";

/** Synchronisation → Conflits (Lot 7), ADMIN only. Rules: lib/server/channels/conflicts.ts. */

export async function resolveConflictAction(conflictId: string, how: "REPLACE" | "DISMISS"): Promise<ChannelFormState> {
  let message: string;
  try {
    const a = await requireAdminAction(SYNC_PATH);
    if (typeof conflictId !== "string" || !ID_RE.test(conflictId) || (how !== "REPLACE" && how !== "DISMISS")) throw new AppError(404, "NOT_FOUND", "Conflit introuvable.");
    const r = await resolveConflict(a, conflictId, how);
    message =
      how === "DISMISS"
        ? "Conflit marqué comme traité."
        : r.cancelledSource && r.cancelledSource !== "DIRECT" && r.cancelledSource !== "OWNER"
          ? `Réservation en place annulée dans Sigma et import enregistré. Annulez-la aussi sur ${SOURCE_LABEL[r.cancelledSource]}.`
          : "Réservation en place annulée et import enregistré.";
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  updateTag(TAGS.availability);
  refresh();
  return { message };
}
