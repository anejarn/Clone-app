/**
 * Deterministic demo data: same input, same rows. Pure (no database access) so tests can use it directly.
 * prisma/seed.ts writes it to Postgres.
 */
import { slugify } from "../lib/search/params";
import type { PropertyTypeKey } from "../lib/labels";
import { MARRAKECH_TIMEZONE, NEIGHBOURHOODS } from "../lib/neighbourhoods";

const img = (seed: string, w = 720, h = 684) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/** mulberry32 PRNG */
export function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Demo price level per neighbourhood: a home's price band (TYPE_BAND_DH) is multiplied by it. */
const PRICE_LEVEL: Record<string, number> = {
  hivernage: 1.5, gueliz: 1, medina: 1.05, palmeraie: 1.6, agdal: 0.85, targa: 0.9, ourika: 1.25, agafay: 1.5, semlalia: 0.85, menara: 0.8,
};
/** Hivernage's top tier (lofts, houses, villas): a fixed band in dirhams, whatever the level. */
const HIVERNAGE_PREMIUM_DH: [number, number] = [3_000, 4_900];

/** [slug, name, country, tagline, lat, lng, timezone] for every neighbourhood of lib/neighbourhoods.ts. */
export const PLACES = NEIGHBOURHOODS.map((p) => [p.slug, p.name, "Maroc", p.tagline, p.lat, p.lng, MARRAKECH_TIMEZONE] as const);

export const AMENITIES = [
  ["wifi", "Wifi", "wifi", "Essentiels"],
  ["cuisine", "Cuisine", "cooking-pot", "Essentiels"],
  ["lave-linge", "Lave-linge", "washing-machine", "Essentiels"],
  ["chauffage", "Chauffage", "heater", "Essentiels"],
  ["climatisation", "Climatisation", "air-vent", "Confort"],
  ["espace-travail", "Espace de travail dédié", "laptop", "Confort"],
  ["television", "Télévision", "tv", "Confort"],
  ["lave-vaisselle", "Lave-vaisselle", "utensils", "Confort"],
  ["parking", "Parking gratuit sur place", "car", "Extérieur"],
  ["balcon", "Balcon", "fence", "Extérieur"],
  ["piscine", "Piscine", "waves", "Extérieur"],
  ["jacuzzi", "Jacuzzi", "bath", "Extérieur"],
  ["cheminee", "Cheminée", "flame", "Confort"],
  ["animaux", "Animaux acceptés", "paw-print", "Règles"],
  ["terrasse", "Terrasse sur le toit", "sun", "Extérieur"],
  ["vue-atlas", "Vue sur l'Atlas", "mountain", "Vue"],
] as const;

/** Hosts: Moroccan first names. Guests: a mix, as at a Marrakech rental. */
const HOST_NAMES = [
  "Youssef", "Fatima Zahra", "Mehdi", "Khadija", "Omar", "Salma", "Hamza", "Nadia", "Karim", "Imane",
  "Rachid", "Leïla", "Anas", "Meryem", "Hicham", "Zineb", "Soukaina", "Yassine", "Houda", "Reda",
  "Samira", "Tarik", "Loubna", "Ayoub", "Hajar", "Ilyas", "Asmae", "Badr", "Ghita", "Driss",
];
const GUEST_NAMES = [
  "Camille", "Thomas", "Sofia", "Yasmine", "James", "Lucía", "Hugo", "Nora", "Marco", "Inès",
  "Olivia", "Mehdi", "Lena", "Pablo", "Chloé", "Adam", "Emma", "Karim", "Julia", "Nathan",
];
const CITY_TYPES: PropertyTypeKey[] = ["APARTMENT", "APARTMENT", "APARTMENT", "APARTMENT", "HOUSE", "LOFT", "STUDIO", "STUDIO", "VILLA", "ROOM", "HOTEL"];
/** Outside the city (Palmeraie, Ourika, Agafay): mostly villas and houses. */
const COUNTRY_TYPES: PropertyTypeKey[] = ["VILLA", "VILLA", "VILLA", "HOUSE", "HOUSE", "APARTMENT"];
const COUNTRY = new Set(["palmeraie", "ourika", "agafay"]);
/** Nightly price band before the neighbourhood's level, in dirhams. One price per home until seasons arrive (Lot 2). */
const TYPE_BAND_DH: Record<PropertyTypeKey, [number, number]> = {
  ROOM: [250, 380], STUDIO: [350, 520], APARTMENT: [480, 900], LOFT: [650, 1_000], HOTEL: [550, 900],
  HOUSE: [900, 1_500], CHALET: [900, 1_500], VILLA: [2_400, 4_000],
};
const PREMIUM_TYPES = new Set<PropertyTypeKey>(["LOFT", "HOUSE", "VILLA"]);
/** Hivernage, in this order: apartments and hotels, plus a top tier of one loft, one house and one villa. */
const HIVERNAGE_TYPES: PropertyTypeKey[] = [
  "APARTMENT", "LOFT", "APARTMENT", "HOTEL", "STUDIO", "APARTMENT", "HOUSE", "APARTMENT", "ROOM", "HOTEL", "VILLA", "APARTMENT",
];
const ADJECTIVES = ["lumineux", "cosy", "charmant", "spacieux", "rénové", "calme", "design", "familial"];
/** Activities: [title, price per person in dirhams, neighbourhoods it starts from]. */
const EXPERIENCES: [string, number, string[]][] = [
  ["Journée dans la vallée de l'Ourika", 450, ["ourika", "hivernage", "gueliz", "agdal"]],
  ["Randonnée aux cascades de Setti Fatma", 550, ["ourika", "targa", "menara"]],
  ["Dîner sous les étoiles à Agafay", 650, ["agafay", "hivernage", "palmeraie"]],
  ["Quad dans le désert d'Agafay", 700, ["agafay", "semlalia", "targa"]],
  ["Cours de cuisine marocaine", 500, ["medina", "gueliz", "semlalia", "agdal", "menara"]],
  ["Balade guidée dans la médina et les souks", 300, ["medina", "gueliz", "hivernage", "agdal"]],
  ["Vol en montgolfière au lever du soleil", 2_200, ["palmeraie", "agafay", "hivernage", "targa", "semlalia", "menara"]],
  ["Hammam traditionnel et gommage", 350, ["medina", "hivernage", "palmeraie", "gueliz", "semlalia", "targa", "menara", "agdal", "ourika"]],
  ["Balade à dromadaire dans la Palmeraie", 400, ["palmeraie", "ourika", "agafay"]],
];
const REVIEW_BODIES = [
  "Logement impeccable, exactement comme sur les photos. Équipe très réactive.",
  "Emplacement idéal pour découvrir Marrakech. Nous reviendrons !",
  "Très bon séjour, literie confortable et quartier calme.",
  "Accueil chaleureux et de bons conseils pour les souks et les restaurants.",
  "Quelques petits détails à revoir mais globalement un très bon rapport qualité-prix.",
  "Superbe terrasse et décoration soignée. Parfait pour un long week-end.",
];

export interface FixtureUser { id: string; name: string; email: string; isProfessional: boolean }
export interface FixtureListing {
  id: string;
  category: "HOME" | "EXPERIENCE";
  propertyType: PropertyTypeKey | null;
  title: string;
  description: string;
  placeSlug: string;
  hostId: string;
  lat: number;
  lng: number;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  priceCents: number;
  cleaningFeeCents: number;
  isGuestFavorite: boolean;
  photos: string[];
  amenities: string[];
}
export interface FixtureReview { listingId: string; authorId: string; rating: number; body: string; createdAt: Date }
export interface FixtureBooking { listingId: string; guestId: string; checkIn: Date; checkOut: Date; adults: number }

const DAY = 86_400_000;
/** Reviews are dated before this fixed point so the dataset doesn't drift. */
const REVIEW_EPOCH = Date.UTC(2026, 8, 1);

export function buildFixtures() {
  const rand = prng(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  const places = PLACES.map(([slug, name, country, tagline, lat, lng, timezone]) => ({
    slug, name, country, tagline, lat, lng, timezone, searchName: slugify(name), imageUrl: img(`place-${slug}`, 480, 480),
  }));

  const hosts: FixtureUser[] = Array.from({ length: 30 }, (_, i) => ({
    id: `host_${i + 1}`,
    name: HOST_NAMES[i % HOST_NAMES.length],
    email: `hote${i + 1}@demo.sigma.test`,
    isProfessional: rand() > 0.75,
  }));
  const guests: FixtureUser[] = Array.from({ length: 40 }, (_, i) => ({
    id: `guest_${i + 1}`,
    name: GUEST_NAMES[(i * 7) % GUEST_NAMES.length],
    email: `voyageur${i + 1}@demo.sigma.test`,
    isProfessional: false,
  }));

  const listings: FixtureListing[] = [];
  let n = 1000;
  for (const place of places) {
    const types = COUNTRY.has(place.slug) ? COUNTRY_TYPES : CITY_TYPES;
    for (let i = 0; i < 12; i++) {
      const type = place.slug === "hivernage" ? HIVERNAGE_TYPES[i] : pick(types);
      const small = type === "ROOM" || type === "STUDIO";
      const maxGuests = small ? 2 : type === "VILLA" ? int(6, 12) : int(2, 8);
      const bedrooms = small ? 1 : Math.max(1, Math.ceil(maxGuests / 2));
      // Whole dirhams, rounded to 10 DH, stored in centimes.
      const premium = place.slug === "hivernage" && PREMIUM_TYPES.has(type);
      const [low, high] = premium ? HIVERNAGE_PREMIUM_DH : TYPE_BAND_DH[type].map((dh) => dh * PRICE_LEVEL[place.slug]);
      const nightlyDh = Math.round((low + rand() * (high - low)) / 10) * 10;
      const amenities = AMENITIES.filter(([id]) => (id === "piscine" && type === "VILLA") || rand() > 0.45).map(([id]) => id);
      listings.push({
        id: String(n++),
        category: "HOME",
        propertyType: type,
        title: `${pick(["Appartement", "Logement", "Séjour", "Pied-à-terre"])} ${pick(ADJECTIVES)} · ${place.name}`,
        description: `Séjour ${pick(ADJECTIVES)} à ${place.name}, Marrakech. Pour ${maxGuests} voyageurs au maximum.`,
        placeSlug: place.slug,
        hostId: pick(hosts).id,
        lat: place.lat + (rand() - 0.5) * 0.02,
        lng: place.lng + (rand() - 0.5) * 0.024,
        maxGuests,
        bedrooms,
        beds: bedrooms + int(0, 1),
        bathrooms: small ? 1 : int(1, type === "VILLA" ? 5 : 3),
        priceCents: nightlyDh * 100,
        cleaningFeeCents: (type === "VILLA" ? int(30, 60) : int(12, 30)) * 1_000,
        isGuestFavorite: rand() > 0.65,
        photos: Array.from({ length: 5 }, (_, k) => img(`home-${n - 1}-${k}`)),
        amenities,
      });
    }
    // Three different activities per neighbourhood, from those that start there.
    const pool = EXPERIENCES.filter(([, , from]) => from.includes(place.slug));
    const offset = Math.floor(rand() * pool.length);
    for (let i = 0; i < 3; i++) {
      const id = String(n++);
      const [title, priceDh] = pool[(offset + i) % pool.length];
      listings.push({
        id,
        category: "EXPERIENCE",
        propertyType: null,
        title,
        description: `${title}, au départ de ${place.name}.`,
        placeSlug: place.slug,
        hostId: pick(hosts).id,
        lat: place.lat,
        lng: place.lng,
        maxGuests: 8,
        bedrooms: 0,
        beds: 0,
        bathrooms: 0,
        priceCents: Math.round((priceDh * (0.9 + rand() * 0.3)) / 10) * 10 * 100,
        cleaningFeeCents: 0,
        isGuestFavorite: rand() > 0.7,
        photos: Array.from({ length: 3 }, (_, k) => img(`exp-${id}-${k}`)),
        amenities: [],
      });
    }
  }

  const reviews: FixtureReview[] = [];
  for (const l of listings) {
    // ~1 in 8 listings is new: fewer than 3 reviews, so no average is shown.
    const count = rand() < 0.12 ? int(0, 2) : int(3, 24);
    for (let i = 0; i < count; i++) {
      reviews.push({
        listingId: l.id,
        authorId: pick(guests).id,
        rating: rand() < 0.8 ? 5 : rand() < 0.85 ? 4 : 3,
        body: pick(REVIEW_BODIES),
        createdAt: new Date(REVIEW_EPOCH - int(1, 700) * DAY),
      });
    }
  }

  return { places, hosts, guests, listings, reviews };
}

/**
 * A few upcoming stays so availability filtering has something to filter.
 * Relative to `today` (UTC midnight), at most one per listing so they never overlap.
 */
export function buildBookings(listings: FixtureListing[], guests: FixtureUser[], today: Date): FixtureBooking[] {
  const rand = prng(7);
  const out: FixtureBooking[] = [];
  for (const l of listings) {
    if (l.category !== "HOME" || rand() > 0.35) continue;
    const start = new Date(today.getTime() + (3 + Math.floor(rand() * 50)) * DAY);
    out.push({
      listingId: l.id,
      guestId: guests[Math.floor(rand() * guests.length)].id,
      checkIn: start,
      checkOut: new Date(start.getTime() + (2 + Math.floor(rand() * 4)) * DAY),
      adults: Math.min(2, l.maxGuests),
    });
  }
  return out;
}
