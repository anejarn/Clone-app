import type { TaskKind } from "./schedule";

/**
 * Check-lists of field tasks. Each organization has a template per task type (table checklist_templates, seeded with
 * DEFAULT_CHECKLISTS); a new task gets a copy of its type's items. The completion rule (a task is DONE only when
 * every item is ticked and every item that requires a photo has one) is checked here, purely, and enforced by the
 * server (lib/server/operations/tasks.ts) whatever the browser sends.
 */

// A type alias (not an interface), so that a list of items is a Prisma JSON value as it is.
export type ChecklistTemplateItem = {
  label: string;
  requiresPhoto: boolean;
};

export const MAX_CHECKLIST_ITEMS = 40;
export const MAX_ITEM_LABEL = 200;

/** The defaults in French; the migration 20261025090000_field_tasks inserts the same for existing organizations. */
export const DEFAULT_CHECKLISTS: Record<TaskKind, ChecklistTemplateItem[]> = {
  CLEANING: [
    { label: "Chambres : lits faits, poussière, sous les lits", requiresPhoto: false },
    { label: "Salle de bain : douche, WC, lavabo, miroir", requiresPhoto: true },
    { label: "Cuisine : vaisselle, plans de travail, frigo vidé", requiresPhoto: true },
    { label: "Sols aspirés et lavés", requiresPhoto: false },
    { label: "Poubelles vidées, sacs neufs", requiresPhoto: false },
    { label: "Linge changé (draps et serviettes)", requiresPhoto: false },
    { label: "Consommables remis (papier, savon, café, thé)", requiresPhoto: false },
    { label: "Photos de chaque pièce", requiresPhoto: true },
  ],
  LINEN: [
    { label: "Draps et housses pour chaque lit", requiresPhoto: false },
    { label: "Serviettes : une grande et une petite par voyageur", requiresPhoto: false },
    { label: "Tapis de bain et torchons", requiresPhoto: false },
    { label: "Linge vérifié : propre, sans tache ni trou", requiresPhoto: true },
  ],
  CHECKIN: [
    { label: "Logement vérifié avant l'arrivée (ménage, clim, eau chaude)", requiresPhoto: false },
    { label: "Remise des clés", requiresPhoto: false },
    { label: "Explication du Wi-Fi (réseau et mot de passe)", requiresPhoto: false },
    { label: "Visite du logement et des équipements", requiresPhoto: false },
    { label: "Règles de la maison rappelées", requiresPhoto: false },
    { label: "Numéro d'urgence Sigma donné", requiresPhoto: false },
    { label: "Photo des compteurs (électricité, eau)", requiresPhoto: true },
  ],
  OTHER: [{ label: "Tâche réalisée", requiresPhoto: false }],
};

/** A template's items as stored (JSON), checked; the default list when the JSON isn't a usable list. */
export function templateItems(json: unknown, type: TaskKind): ChecklistTemplateItem[] {
  if (!Array.isArray(json)) return DEFAULT_CHECKLISTS[type];
  const items = json
    .filter((x): x is { label: string; requiresPhoto?: unknown } => typeof x === "object" && x !== null && typeof (x as { label?: unknown }).label === "string")
    .map((x) => ({ label: x.label.trim().slice(0, MAX_ITEM_LABEL), requiresPhoto: x.requiresPhoto === true }))
    .filter((x) => x.label.length > 0)
    .slice(0, MAX_CHECKLIST_ITEMS);
  return items.length ? items : DEFAULT_CHECKLISTS[type];
}

export interface ChecklistState {
  id: string;
  label: string;
  requiresPhoto: boolean;
  checked: boolean;
  /** Photos uploaded for this item. */
  photoCount: number;
}

export interface CompletionBlockers {
  /** Labels of the items not ticked yet. */
  unchecked: string[];
  /** Labels of the items that require a photo and have none. */
  missingPhotos: string[];
}

/** What still stops a task from being DONE; both lists empty = it can be finished. */
export function completionBlockers(items: readonly ChecklistState[]): CompletionBlockers {
  return {
    unchecked: items.filter((i) => !i.checked).map((i) => i.label),
    missingPhotos: items.filter((i) => i.requiresPhoto && i.photoCount === 0).map((i) => i.label),
  };
}

export function canComplete(items: readonly ChecklistState[]): boolean {
  const b = completionBlockers(items);
  return b.unchecked.length === 0 && b.missingPhotos.length === 0;
}

/** "Il reste à cocher : … Photo obligatoire manquante : …" (French, for the agent). */
export function blockersMessage(b: CompletionBlockers): string {
  const parts: string[] = [];
  if (b.unchecked.length) parts.push(`Il reste à cocher : ${b.unchecked.join(", ")}.`);
  if (b.missingPhotos.length) parts.push(`${b.missingPhotos.length > 1 ? "Photos obligatoires manquantes" : "Photo obligatoire manquante"} : ${b.missingPhotos.join(", ")}.`);
  return parts.join(" ");
}
