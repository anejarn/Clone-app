import type { PlatformSource } from "../admin/booking-sources";

/**
 * The step-by-step guide of Biens → a home → Plateformes (Lot 7b): how to connect a home's calendar with each
 * platform. The platforms rename and move their menus often: the wording stays generic (where the calendar
 * synchronisation usually is, what to look for), never a menu path given as a fact, and every guide says « à vérifier
 * sur l'interface actuelle de la plateforme ». Checked steps (CHECKLIST) are partly automatic (import link saved, the
 * platform read Sigma's export, a successful read) and partly ticked by hand (export pasted, rules set, test done).
 */

export const GUIDE_CAVEAT = "À vérifier sur l'interface actuelle de la plateforme : les menus changent souvent et leur nom peut différer selon la langue du compte.";

export interface PlatformGuide {
  /** Where the calendar synchronisation (iCal) usually is, in a sentence. */
  where: string;
  /** Steps to give the platform Sigma's export link. */
  exportSteps: string[];
  /** Steps to find the platform's own iCal link (to paste in Sigma). */
  importSteps: string[];
  /** The platform's booking rules to set like Sigma's (preparation days, minimum notice). */
  rulesSteps: string[];
  /** Anything specific to the platform. */
  notes: string[];
}

const COMMON_RULES = [
  "Dans les règles de réservation de l'annonce, réglez le délai de préparation (nuits bloquées avant et après chaque séjour) et le préavis minimum comme dans Sigma (bloc « Protection contre les doubles réservations » ci-dessus).",
  "Vérifiez aussi le séjour minimum et les prix : ils ne passent pas par iCal (voir Synchronisation → Prix à reporter).",
];

const COMMON_TEST = "Test : après avoir collé les deux liens, cliquez sur « Synchroniser maintenant » ici, puis vérifiez sur la plateforme que les dates occupées de Sigma apparaissent (cela peut prendre plusieurs heures côté plateforme).";

export const PLATFORM_GUIDES: Record<PlatformSource, PlatformGuide> = {
  AIRBNB: {
    where: "Côté hôte, dans le calendrier ou les disponibilités de l'annonce, rubrique de synchronisation ou d'association de calendriers (iCal).",
    exportSteps: [
      "Ouvrez l'annonce concernée dans l'espace hôte, puis la partie calendrier / disponibilités.",
      "Cherchez l'option pour importer ou associer un calendrier externe.",
      "Collez le lien d'export Sigma de ce bien (bouton « Copier le lien » ci-dessous) et donnez-lui un nom, par exemple « Sigma ».",
    ],
    importSteps: [
      "Au même endroit, cherchez l'option pour exporter le calendrier de l'annonce : la plateforme affiche un lien se terminant en général par .ics.",
      "Copiez ce lien et collez-le dans « Lien iCal de la plateforme » ci-dessous, puis enregistrez.",
    ],
    rulesSteps: COMMON_RULES,
    notes: [
      "Le code de réservation (HM…) est lu dans le calendrier et dans les e-mails de confirmation : une réservation saisie à la main avec le même code n'est pas dupliquée.",
      "Notez l'identifiant de l'annonce (le nombre dans l'adresse de l'annonce) dans « Nom de ce bien sur la plateforme » : il sert à reconnaître les e-mails.",
    ],
  },
  BOOKING: {
    where: "Dans l'extranet de l'établissement, partie tarifs et disponibilités, rubrique de synchronisation des calendriers (iCal).",
    exportSteps: [
      "Ouvrez l'extranet de l'établissement, puis la partie calendrier / disponibilités.",
      "Cherchez la synchronisation de calendrier et l'option pour importer un calendrier (selon le type d'hébergement, elle peut être réservée à certains types de logement).",
      "Collez le lien d'export Sigma de ce bien.",
    ],
    importSteps: [
      "Au même endroit, cherchez l'option d'export : la plateforme donne un lien .ics.",
      "Collez-le dans « Lien iCal de la plateforme » ci-dessous.",
    ],
    rulesSteps: COMMON_RULES,
    notes: [
      "Le calendrier de cette plateforme ne distingue pas une réservation d'une date fermée : les e-mails de réservation complètent le code, le nom et le montant.",
      "Notez l'identifiant de l'établissement (affiché dans l'extranet et dans les e-mails) dans « Nom de ce bien sur la plateforme ».",
    ],
  },
  AGODA: {
    where: "Dans l'espace partenaire (gestion de l'établissement), partie calendrier ou disponibilités, rubrique de synchronisation iCal.",
    exportSteps: [
      "Ouvrez l'espace partenaire de l'établissement, partie calendrier.",
      "Cherchez l'import de calendrier externe (iCal) et collez le lien d'export Sigma de ce bien.",
    ],
    importSteps: ["Au même endroit, cherchez l'export de calendrier et copiez le lien .ics.", "Collez-le dans « Lien iCal de la plateforme » ci-dessous."],
    rulesSteps: COMMON_RULES,
    notes: ["Selon le contrat, la synchronisation iCal peut ne pas être proposée : demandez-la au gestionnaire de compte de la plateforme si vous ne la trouvez pas."],
  },
  TRIPCOM: {
    where: "Dans l'espace partenaire de l'hébergement, partie calendrier ou gestion des chambres, rubrique de synchronisation iCal.",
    exportSteps: ["Ouvrez l'espace partenaire, partie calendrier.", "Cherchez l'import de calendrier externe (iCal) et collez le lien d'export Sigma de ce bien."],
    importSteps: ["Au même endroit, cherchez l'export de calendrier et copiez le lien .ics.", "Collez-le dans « Lien iCal de la plateforme » ci-dessous."],
    rulesSteps: COMMON_RULES,
    notes: ["Selon le type de compte, la synchronisation iCal peut devoir être activée par le support de la plateforme."],
  },
  EXPEDIA: {
    where: "Dans l'espace propriétaire, partie calendrier, rubrique d'import et d'export de calendriers.",
    exportSteps: ["Ouvrez l'annonce, partie calendrier.", "Cherchez l'import de calendrier et collez le lien d'export Sigma de ce bien."],
    importSteps: ["Au même endroit, cherchez l'export de calendrier et copiez le lien .ics.", "Collez-le dans « Lien iCal de la plateforme » ci-dessous."],
    rulesSteps: COMMON_RULES,
    notes: [],
  },
  OTHER: {
    where: "Cherchez dans l'espace hôte / partenaire de la plateforme une rubrique « calendrier », « synchronisation », « iCal » ou « .ics ».",
    exportSteps: ["Cherchez l'import de calendrier externe et collez le lien d'export Sigma de ce bien."],
    importSteps: ["Cherchez l'export de calendrier (un lien .ics) et collez-le dans « Lien iCal de la plateforme » ci-dessous."],
    rulesSteps: COMMON_RULES,
    notes: ["Si la plateforme ne propose pas d'iCal, bloquez les dates à la main et saisissez ses réservations dans Réservations (« Nouvelle saisie »)."],
  },
};

export type ChecklistKey = "importSet" | "exportPasted" | "rulesSet" | "testDone";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
  /** How it is known: the system saw it, or an associé ticked it. */
  how: "auto" | "manual" | null;
  /** Can be ticked by hand (the others are seen by Sigma). */
  manual: boolean;
  detail: string | null;
}

export interface ChecklistInput {
  importSet: boolean;
  /** The platform fetched the export link at least once. */
  exportLastReadAt: string | null;
  lastSuccessAt: string | null;
  /** Ticks by hand: ISO instants. */
  ticks: Partial<Record<"exportPasted" | "rulesSet" | "testDone", string>>;
}

export const MANUAL_TICKS = ["exportPasted", "rulesSet", "testDone"] as const;
export type ManualTick = (typeof MANUAL_TICKS)[number];

export function isManualTick(s: unknown): s is ManualTick {
  return typeof s === "string" && (MANUAL_TICKS as readonly string[]).includes(s);
}

/** Reads the stored ticks; anything else is ignored. */
export function parseTicks(json: unknown): ChecklistInput["ticks"] {
  const out: ChecklistInput["ticks"] = {};
  if (json && typeof json === "object" && !Array.isArray(json)) {
    for (const k of MANUAL_TICKS) {
      const v = (json as Record<string, unknown>)[k];
      if (typeof v === "string" && !Number.isNaN(Date.parse(v))) out[k] = v;
    }
  }
  return out;
}

export function checklist(i: ChecklistInput, fmt: (iso: string) => string): ChecklistItem[] {
  return [
    { key: "importSet", label: "Lien iCal de la plateforme collé dans Sigma (import)", done: i.importSet, how: i.importSet ? "auto" : null, manual: false, detail: null },
    {
      key: "exportPasted",
      label: "Lien d'export Sigma collé sur la plateforme (export)",
      done: !!i.exportLastReadAt || !!i.ticks.exportPasted,
      how: i.exportLastReadAt ? "auto" : i.ticks.exportPasted ? "manual" : null,
      manual: true,
      detail: i.exportLastReadAt ? `lu par la plateforme le ${fmt(i.exportLastReadAt)}` : null,
    },
    {
      key: "rulesSet",
      label: "Délai de préparation et préavis minimum réglés sur la plateforme",
      done: !!i.ticks.rulesSet,
      how: i.ticks.rulesSet ? "manual" : null,
      manual: true,
      detail: null,
    },
    {
      key: "testDone",
      label: "Synchronisation testée (dates de Sigma visibles sur la plateforme, import lu sans erreur)",
      done: !!i.ticks.testDone,
      how: i.ticks.testDone ? "manual" : null,
      manual: true,
      detail: i.lastSuccessAt ? `dernière lecture réussie le ${fmt(i.lastSuccessAt)}` : "aucune lecture réussie pour l'instant",
    },
  ];
}

export { COMMON_TEST };
