/** Display labels shared by server and client code. Keys mirror the Prisma PropertyType enum. */
export const PROPERTY_TYPE_LABEL = {
  APARTMENT: "Appartement",
  HOUSE: "Maison",
  LOFT: "Loft",
  STUDIO: "Studio",
  VILLA: "Villa",
  CHALET: "Chalet",
  ROOM: "Chambre",
  HOTEL: "Hôtel",
} as const;

export type PropertyTypeKey = keyof typeof PROPERTY_TYPE_LABEL;

/** Below this many reviews a listing shows "Nouveau" instead of an average. */
export const MIN_REVIEWS_FOR_RATING = 3;

/** Up to this many metres from the nearest lift, a home is "Ski aux pieds". */
export const SKI_IN_MAX_M = 50;

/** "Meublé 3★" for a classified meublé de tourisme, "Non classé" otherwise. */
export function classificationLabel(stars: number | null): string {
  return stars ? `Meublé ${stars}★` : "Non classé";
}

/** "Ski aux pieds" up to SKI_IN_MAX_M, else "À 350 m des pistes" (non-breaking space before the unit). */
export function liftDistanceLabel(metres: number): string {
  return metres <= SKI_IN_MAX_M ? "Ski aux pieds" : `À ${metres} m des pistes`;
}

/** "Séjour de 3 nuits minimum" */
export function minNightsLabel(n: number): string {
  return `Séjour de ${n} nuit${n > 1 ? "s" : ""} minimum`;
}
