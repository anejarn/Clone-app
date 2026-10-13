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
