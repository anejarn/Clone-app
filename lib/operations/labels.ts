import type { TaskKind } from "./schedule";

/** French labels of field tasks (Opérations, Mes tâches). */

export type TaskState = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export const TASK_TYPE_LABEL: Record<TaskKind, string> = {
  CLEANING: "Ménage",
  LINEN: "Linge",
  CHECKIN: "Accueil",
  OTHER: "Autre",
};

/** Longer names, for a task without a title. */
export const TASK_TYPE_TITLE: Record<TaskKind, string> = {
  CLEANING: "Ménage après départ",
  LINEN: "Préparation du linge",
  CHECKIN: "Accueil à l'arrivée",
  OTHER: "Tâche",
};

export const TASK_STATUS_LABEL: Record<TaskState, string> = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  DONE: "Fait",
  CANCELLED: "Annulée",
};

export const TASK_TYPES: readonly TaskKind[] = ["CLEANING", "LINEN", "CHECKIN", "OTHER"];
export const TASK_STATES: readonly TaskState[] = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"];

/** URL values of the filters (French, readable in the address bar). */
export const TASK_TYPE_PARAM = { menage: "CLEANING", linge: "LINEN", accueil: "CHECKIN", autre: "OTHER" } as const satisfies Record<string, TaskKind>;
export const TASK_STATUS_PARAM = { a_faire: "TODO", en_cours: "IN_PROGRESS", fait: "DONE", annulee: "CANCELLED" } as const satisfies Record<string, TaskState>;
