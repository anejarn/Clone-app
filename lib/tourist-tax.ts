/**
 * Taxe de séjour: Nidou collects it from guests on behalf of the commune. Pure, so the booking card can show
 * the same figure the server charges.
 *
 * Rates are per adult per night, in cents, and already include the 10 % Hautes-Alpes departmental surcharge.
 * - Classified "meublés de tourisme" (1–5 stars) pay the commune's flat rate for their class.
 * - Unclassified ones pay 5.5 % of the nightly cost per occupant, capped at the commune's highest rate.
 * - Minors are exempt. The guest picker's "Adultes" are 13+, so teenagers (13–17) are approximated as adults
 *   and may be charged when they are in fact exempt; children and infants never are.
 */

export type Stars = 1 | 2 | 3 | 4 | 5;

export interface TouristTaxGrid {
  inseeCode: string;
  commune: string;
  /** Which deliberation the rates come from and from when they apply. */
  validity: string;
  sources: string[];
  /** Flat rate per adult per night by star rating, in cents. */
  classified: Record<Stars, number>;
  /** Unclassified homes: share of the nightly cost per occupant, in basis points (550 = 5.5 %). */
  unclassifiedBps: number;
  /** Unclassified homes: per adult per night ceiling, in cents. */
  unclassifiedCapCents: number;
}

export const TOURIST_TAX_GRIDS: Record<string, TouristTaxGrid> = {
  // Orcières, 2026 rates, mairie deliberation of 2 June 2025 ("Tarif par personne et par nuitée - 2026").
  // The cap is the palace rate, €4.00 + 10 % = €4.40.
  "05096": {
    inseeCode: "05096",
    commune: "Orcières",
    validity: "2026 (délibération du 2 juin 2025)",
    sources: [
      "https://orcieres.taxesejour.fr/portail/document/27925991/download",
      "DGFiP DELTA, jeu de données delta_deliberation_ts_tarif0 (https://data.economie.gouv.fr/explore/dataset/delta_deliberation_ts_tarif0/)",
    ],
    classified: { 1: 88, 2: 99, 3: 121, 4: 132, 5: 330 },
    unclassifiedBps: 550,
    unclassifiedCapCents: 440,
  },
  // Les Orres, deliberation effective 2024 with no end date, still the one in force in DGFiP DELTA on
  // 13 October 2026. The cap is the commune's highest adopted rate, palaces €2.80 + 10 % = €3.08.
  "05098": {
    inseeCode: "05098",
    commune: "Les Orres",
    validity: "depuis 2024, sans date de fin",
    sources: [
      "DGFiP DELTA, jeu de données delta_deliberation_ts_tarif0 (https://data.economie.gouv.fr/explore/dataset/delta_deliberation_ts_tarif0/)",
    ],
    classified: { 1: 88, 2: 99, 3: 154, 4: 209, 5: 275 },
    unclassifiedBps: 550,
    unclassifiedCapCents: 308,
  },
};

export function touristTaxGrid(inseeCode: string): TouristTaxGrid {
  const grid = TOURIST_TAX_GRIDS[inseeCode];
  if (!grid) throw new Error(`No taxe de séjour grid for commune ${inseeCode}`);
  return grid;
}

export interface TouristTaxInput {
  inseeCode: string;
  /** 1–5, or null when unclassified. */
  stars: number | null;
  /** Nightly price of the home (cleaning excluded), in cents. */
  nightlyCents: number;
  nights: number;
  adults: number;
  children?: number;
  infants?: number;
}

export interface TouristTax {
  /** Rate charged per liable person per night, in cents. */
  perPersonNightCents: number;
  /** Adults; minors are exempt. */
  liablePersons: number;
  totalCents: number;
}

/** Rate per adult per night, in cents. */
export function touristTaxRate(input: Omit<TouristTaxInput, "nights">): number {
  const grid = touristTaxGrid(input.inseeCode);
  if (input.stars !== null) {
    if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new RangeError(`Invalid star rating: ${input.stars}`);
    return grid.classified[input.stars as Stars];
  }
  const occupants = input.adults + (input.children ?? 0) + (input.infants ?? 0);
  if (occupants < 1) return 0;
  // round(nightly / occupants × bps / 10 000), computed in one division so it stays exact on ties.
  const proportional = Math.round((input.nightlyCents * grid.unclassifiedBps) / (occupants * 10_000));
  return Math.min(proportional, grid.unclassifiedCapCents);
}

/** Tax for a whole stay, in integer cents. Throws for a commune without a grid. */
export function touristTax(input: TouristTaxInput): TouristTax {
  const perPersonNightCents = touristTaxRate(input);
  const liablePersons = Math.max(0, input.adults);
  const nights = Math.max(0, input.nights);
  return { perPersonNightCents, liablePersons, totalCents: perPersonNightCents * liablePersons * nights };
}
