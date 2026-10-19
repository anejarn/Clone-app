import type { CommissionBase, FeeBeneficiary, FinanceFeeSource, FinanceGrossSource, FinanceSplitStatus, RevenueAllocation } from "@/lib/generated/prisma/enums";

/** French labels of the finances (Lot 6). */

export const SPLIT_STATUS_LABEL: Record<FinanceSplitStatus, string> = {
  COMPLETE: "Calculée",
  MISSING_AMOUNT: "Montant à saisir",
  MISSING_RATE: "Taux de change à saisir",
  CANCELLED: "Annulée (rien à répartir)",
  NOT_APPLICABLE: "Sans objet",
};

export const GROSS_SOURCE_LABEL: Record<FinanceGrossSource, string> = {
  BOOKING: "montant de la réservation",
  EMAIL: "e-mail de la plateforme",
  MANUAL: "saisi par un associé",
  ESTIMATE: "estimé à partir du versement",
};

export const FEE_SOURCE_LABEL: Record<FinanceFeeSource, string> = {
  NONE: "aucun",
  EMAIL: "d'après l'e-mail (total − versement)",
  MANUAL: "saisis par un associé",
  ESTIMATE: "estimation au taux par défaut de la plateforme",
};

export const BENEFICIARY_LABEL: Record<FeeBeneficiary, string> = { SIGMA: "Sigma", OWNER: "Le propriétaire" };

export const COMMISSION_BASE_LABEL: Record<CommissionBase, string> = {
  NET_EXCL_CLEANING: "Revenu net des frais de plateforme, hors ménage et taxe de séjour",
  GROSS_EXCL_CLEANING: "Revenu brut (avant frais de plateforme), hors ménage et taxe de séjour",
};

export const ALLOCATION_LABEL: Record<RevenueAllocation, string> = {
  NIGHTS: "Au prorata des nuits de chaque mois",
  CHECKOUT: "Entièrement dans le mois du départ",
};

export const MANAGEMENT_LABEL = { MANAGED: "Mandat de gestion", SUBLEASE: "Sous-location" } as const;
